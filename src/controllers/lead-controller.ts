import { FastifyRequest, FastifyReply } from 'fastify';
import { createHash, createHmac } from 'node:crypto';
import { leadRequestSchema } from '../types/lead-request.js';
import { queueInstance } from '../queue/queue-manager.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';
import { encryptCredentials } from '../integrations/syonet/credentials.js';
import type { EncryptedCredentialEnvelope } from '../integrations/syonet/credentials.js';
import type { LeadJob } from '../queue/types.js';
import type { DuotalkLeadData } from '../types/lead-request.js';
import type { SyonetTarget } from '../integrations/syonet/target.js';
import { isSyonetConfigurationErrorCode } from '../integrations/syonet/errors.js';
import { parsePhoneNumber } from '../utils/phone-parser.js';
import { processLeadViaApi } from '../integrations/syonet/api-client.js';

let enqueueLock = Promise.resolve();
// Domínio histórico mantido como valor opaco para preservar fingerprints persistidos.
const DEDUP_HMAC_DOMAIN = Buffer.from('ZHVvdGFsay1zeW9uZXQtYm90OmRlZHVwOnYy', 'base64');

export function buildDedupKey(
  leadData: DuotalkLeadData,
  syonetUrl: string,
  target: SyonetTarget,
  dryRun = false,
): string {
  const tenantScope = createHash('sha256')
    .update(`${new URL(syonetUrl).origin}:${target.companyId}`)
    .digest('hex');
  const leadScope = leadData.idConversa
    ? `conv_${leadData.idConversa}`
    : leadData.id
      ? `lead_${leadData.id}`
      : `phone_${leadData.telefone.replace(/\D/g, '')}`;
  const contactState = JSON.stringify({
    email: (leadData.email ?? '').normalize('NFKC').trim().toLocaleLowerCase('pt-BR'),
    name: leadData.nome.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR'),
    phone: parsePhoneNumber(leadData.telefone).fullWithoutDdi,
  });
  const dedupHmacKey = createHmac('sha256', Buffer.from(env.CREDENTIAL_ENCRYPTION_KEY, 'base64'))
    .update(DEDUP_HMAC_DOMAIN)
    .digest();
  const leadFingerprint = createHmac('sha256', dedupHmacKey)
    .update(`${leadScope}:${contactState}`)
    .digest('hex');
  const executionMode = dryRun ? 'dry-run' : 'write';
  return `${tenantScope}:${executionMode}:${leadFingerprint}`;
}

async function enqueueDeduplicated(
  leadData: DuotalkLeadData,
  credentialEnvelope: EncryptedCredentialEnvelope,
  target: SyonetTarget,
  dedupKey: string,
  dedupWindowMinutes: number,
  dryRun: boolean,
  daysToUpdateOpenEvent: number,
): Promise<{ duplicate: boolean; job: LeadJob }> {
  const previousLock = enqueueLock;
  let releaseLock = (): void => undefined;
  enqueueLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  await previousLock;

  try {
    const duplicate = await queueInstance.findDuplicate(dedupKey, dedupWindowMinutes);
    if (duplicate) return { duplicate: true, job: duplicate };
    const job = await queueInstance.enqueue(
      leadData,
      credentialEnvelope,
      target,
      dedupKey,
      dryRun,
      daysToUpdateOpenEvent,
    );
    return { duplicate: false, job };
  } finally {
    releaseLock();
  }
}

function toPublicJob(job: Awaited<ReturnType<typeof queueInstance.getJob>>) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    errorCode: job.errorCode,
    result: job.result,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export async function handleLeadRequest(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parsedRequest = leadRequestSchema.parse(request.body);
  const query = request.query as { sync?: string };
  const isSyncRequested = query?.sync !== 'false';
  const dryRun = parsedRequest.dryRun ?? false;
  const daysToUpdateOpenEvent = parsedRequest.daysToUpdateOpenEvent ?? 0;

  if (!env.QUEUE_ENABLED) {
    if (!isSyncRequested) {
      logger.warn('Requisição assíncrona rejeitada: fila desativada por configuração');
      return reply.status(503).send({
        success: false,
        message: 'Processamento assíncrono indisponível: fila desativada por configuração',
      });
    }

    try {
      const result = await processLeadViaApi(
        parsedRequest.data,
        parsedRequest.credentials,
        parsedRequest.target,
        undefined,
        { dryRun, daysToUpdateOpenEvent },
      );
      return reply.status(200).send({
        success: true,
        message: 'Lead processado no Syonet CRM com sucesso',
        status: 'completed',
        result,
      });
    } catch (error: unknown) {
      const errorCode =
        error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
          ? error.code
          : undefined;
      const statusCode = isSyonetConfigurationErrorCode(errorCode) ? 422 : 500;
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          errorCode,
        },
        'Falha no processamento síncrono direto do lead',
      );
      return reply.status(statusCode).send({
        success: false,
        message: 'Falha no processamento síncrono do lead',
        status: 'failed',
        errorCode,
      });
    }
  }

  if (!queueInstance.hasWorker()) {
    logger.error('Requisição rejeitada: nenhum processador de fila ativo');
    return reply.status(503).send({
      success: false,
      message: 'Processamento indisponível: nenhum processador de fila ativo',
    });
  }

  const leadData = parsedRequest.data;
  const credentialEnvelope = encryptCredentials(parsedRequest.credentials);

  logger.info('Recebida requisição de processamento de lead');

  // A desduplicação é isolada por origem e unidade sem persistir a URL em texto claro.
  const dedupKey = buildDedupKey(
    leadData,
    parsedRequest.credentials.url,
    parsedRequest.target,
    dryRun,
  );
  const dedupWindowMinutes =
    leadData.idConversa || leadData.id
      ? env.JOB_RETENTION_DAYS * 24 * 60
      : env.DEDUP_WINDOW_MINUTES;

  const enqueueResult = await enqueueDeduplicated(
    leadData,
    credentialEnvelope,
    parsedRequest.target,
    dedupKey,
    dedupWindowMinutes,
    dryRun,
    daysToUpdateOpenEvent,
  );
  const job = enqueueResult.job;
  if (enqueueResult.duplicate) {
    logger.warn({ jobId: job.id, status: job.status }, 'Requisição duplicada detectada e ignorada');
    const duplicateStatusCode =
      job.status === 'failed' ? 409 : job.status === 'completed' ? 200 : 202;
    const duplicateMessage =
      job.status === 'completed'
        ? 'Requisição já processada anteriormente'
        : job.status === 'failed'
          ? 'Requisição duplicada com falha que exige conciliação'
          : 'Requisição já aceita e ainda em processamento';
    return reply.status(duplicateStatusCode).send({
      success: job.status !== 'failed',
      message: duplicateMessage,
      jobId: job.id,
      status: job.status,
      duplicate: true,
      errorCode: job.errorCode,
      result: job.result,
    });
  }

  if (isSyncRequested) {
    // Aguarda a conclusão do job para responder de forma síncrona
    let updatedJob = await queueInstance.getJob(job.id);
    const deadline = Date.now() + env.SYNC_TIMEOUT_MS;
    while (
      updatedJob &&
      (updatedJob.status === 'pending' || updatedJob.status === 'processing') &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      updatedJob = await queueInstance.getJob(job.id);
    }

    if (updatedJob?.status === 'pending' || updatedJob?.status === 'processing') {
      return reply.status(504).send({
        success: false,
        message: 'Tempo síncrono esgotado; consulte o job para confirmar o resultado',
        jobId: job.id,
        status: updatedJob.status,
      });
    }

    if (updatedJob?.status === 'completed') {
      return reply.status(200).send({
        success: true,
        message: 'Lead processado e gravado no Syonet CRM com sucesso (Modo Síncrono)',
        jobId: job.id,
        status: updatedJob.status,
        result: updatedJob.result,
      });
    }

    const statusCode = isSyonetConfigurationErrorCode(updatedJob?.errorCode) ? 422 : 500;
    return reply.status(statusCode).send({
      success: false,
      message: 'Falha no processamento síncrono do lead',
      jobId: job.id,
      status: updatedJob?.status || 'failed',
      errorCode: updatedJob?.errorCode,
    });
  }

  return reply.status(202).send({
    success: true,
    message: 'Lead recebido e enfileirado com sucesso para gravação no Syonet CRM',
    jobId: job.id,
    status: job.status,
  });
}

export async function getQueueStatus(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const stats = await queueInstance.getStats();
  return reply.send({ success: true, stats });
}

export async function getJobDetails(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params;
  const job = await queueInstance.getJob(id);

  if (!job) {
    return reply.status(404).send({ success: false, message: 'Job não encontrado' });
  }

  return reply.send({ success: true, job: toPublicJob(job) });
}

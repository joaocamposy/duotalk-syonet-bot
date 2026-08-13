import { FastifyRequest, FastifyReply } from 'fastify';
import {
  duotalkWebhookSchema,
  duotalkLeadDataSchema,
  DuotalkLeadData,
} from '../types/duotalk-payload.js';
import { queueInstance } from '../queue/queue-manager.js';
import { logger } from '../utils/logger.js';

export async function handleDuotalkWebhook(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = request.body as Record<string, unknown>;

  let leadData: DuotalkLeadData;

  // Aceita tanto payload envelopado { data: {...} } quanto direto {...}
  if (body && typeof body === 'object' && 'data' in body) {
    const parsedWebhook = duotalkWebhookSchema.parse(body);
    leadData = parsedWebhook.data;
  } else {
    leadData = duotalkLeadDataSchema.parse(body);
  }

  // Extração de credenciais dinâmicas do Syonet via Headers HTTP (se fornecidos)
  const headerUser = (request.headers['x-syonet-user'] || request.headers['syonet-user']) as string;
  const headerPass = (request.headers['x-syonet-pass'] || request.headers['syonet-pass']) as string;
  const headerUrl = (request.headers['x-syonet-url'] || request.headers['syonet-url']) as string;

  // Se houver header Authorization Bearer com Base64 (user:pass)
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf-8');
      const [u, p] = decoded.split(':');
      if (u && p) {
        leadData.syonetUser = leadData.syonetUser || u;
        leadData.syonetPass = leadData.syonetPass || p;
      }
    } catch {
      logger.warn('Token Bearer fornecido não pôde ser decodificado como base64(user:pass)');
    }
  }

  if (headerUser) leadData.syonetUser = headerUser;
  if (headerPass) leadData.syonetPass = headerPass;
  if (headerUrl) leadData.syonetUrl = headerUrl;

  logger.info(
    {
      leadName: leadData.nome,
      phone: leadData.telefone,
      syonetUser: leadData.syonetUser || 'default-env',
    },
    'Recebido webhook de criação de lead do Duotalk',
  );

  // Chave de desduplicação: usa idConversa / id ou telefone sanitizado
  const dedupKey =
    leadData.idConversa || leadData.id || `phone_${leadData.telefone.replace(/\D/g, '')}`;

  // Verifica se existe um job idêntico recente
  const duplicateJob = await queueInstance.findDuplicate(dedupKey, env.DEDUP_WINDOW_MINUTES);

  if (duplicateJob) {
    logger.warn(
      { jobId: duplicateJob.id, dedupKey, status: duplicateJob.status },
      'Requisição duplicada detectada e ignorada',
    );
    return reply.status(200).send({
      success: true,
      message: 'Requisição duplicada ignorada (Job idêntico recente já registrado)',
      jobId: duplicateJob.id,
      status: duplicateJob.status,
      duplicate: true,
    });
  }

  const query = request.query as { sync?: string };
  const isSyncRequested =
    query?.sync === 'true' ||
    request.headers['x-sync'] === 'true' ||
    request.headers['sync'] === 'true';

  if (isSyncRequested) {
    if (!queueInstance.hasWorker()) {
      logger.error('Requisição rejeitada: nenhum worker ativo registrado na aplicação.');
      return reply.status(503).send({
        success: false,
        message:
          'Processamento indisponível: nenhum worker ativo registrado para executar a automação',
      });
    }

    const job = await queueInstance.enqueue(leadData, dedupKey);

    // Aguarda a conclusão do job para responder de forma síncrona
    let updatedJob = await queueInstance.getJob(job.id);
    while (updatedJob && (updatedJob.status === 'pending' || updatedJob.status === 'processing')) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      updatedJob = await queueInstance.getJob(job.id);
    }

    if (updatedJob?.status === 'completed') {
      return reply.status(200).send({
        success: true,
        message: 'Lead processado e gravado no Syonet CRM com sucesso (Modo Síncrono)',
        jobId: job.id,
        status: updatedJob.status,
      });
    }

    return reply.status(500).send({
      success: false,
      message: 'Falha no processamento síncrono do lead',
      jobId: job.id,
      status: updatedJob?.status || 'failed',
      error: updatedJob?.error,
    });
  }

  const job = await queueInstance.enqueue(leadData, dedupKey);

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

  return reply.send({ success: true, job });
}

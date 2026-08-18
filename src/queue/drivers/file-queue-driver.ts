import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { duotalkLeadDataSchema } from '../../types/duotalk-payload.js';
import type { DuotalkLeadData } from '../../types/duotalk-payload.js';
import { JobProcessor, QueueDriver, QueueStats, LeadJob } from '../types.js';
import { logger } from '../../utils/logger.js';
import type { EncryptedCredentialEnvelope } from '../../credentials/credential-envelope.js';
import {
  isSyonetConfigurationErrorCode,
  NonRetryableJobError,
  QueueCapacityError,
  SYONET_COMPANY_ACCESS_DENIED,
} from '../job-errors.js';
import { syonetTargetSchema, SyonetTarget } from '../../types/syonet-target.js';

function isCanonicalBase64(value: unknown, expectedBytes?: number): value is string {
  if (typeof value !== 'string' || !value) return false;
  const decoded = Buffer.from(value, 'base64');
  return (
    decoded.length > 0 &&
    (expectedBytes === undefined || decoded.length === expectedBytes) &&
    decoded.toString('base64') === value
  );
}

function isEncryptedCredentialEnvelope(value: unknown): value is EncryptedCredentialEnvelope {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as Partial<EncryptedCredentialEnvelope>;
  return (
    envelope.algorithm === 'aes-256-gcm' &&
    envelope.version === 1 &&
    isCanonicalBase64(envelope.iv, 12) &&
    isCanonicalBase64(envelope.authTag, 16) &&
    isCanonicalBase64(envelope.ciphertext)
  );
}

function isValidDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isStoredLeadJob(value: unknown): value is LeadJob {
  if (!value || typeof value !== 'object') return false;
  const job = value as Partial<LeadJob>;
  const validStatus = ['pending', 'processing', 'completed', 'failed'].includes(String(job.status));
  const needsCredentials = job.status === 'pending' || job.status === 'processing';
  return (
    typeof job.id === 'string' &&
    (needsCredentials
      ? duotalkLeadDataSchema.safeParse(job.data).success
      : job.data === undefined || duotalkLeadDataSchema.safeParse(job.data).success) &&
    validStatus &&
    Number.isInteger(job.attempts) &&
    Number(job.attempts) >= 0 &&
    Number.isInteger(job.maxAttempts) &&
    Number(job.maxAttempts) >= 1 &&
    Number(job.attempts) <= Number(job.maxAttempts) &&
    isValidDate(job.createdAt) &&
    isValidDate(job.updatedAt) &&
    (job.target === undefined || syonetTargetSchema.safeParse(job.target).success) &&
    (job.dedupKey === undefined || typeof job.dedupKey === 'string') &&
    (job.errorCode === undefined || typeof job.errorCode === 'string') &&
    (!needsCredentials || isEncryptedCredentialEnvelope(job.credentialEnvelope))
  );
}

export class FileQueueDriver implements QueueDriver {
  public name = 'file';
  private filePath: string;
  private concurrency: number;
  private jobs: Map<string, LeadJob> = new Map();
  private activeCount = 0;
  private processor?: JobProcessor;
  private persistenceChain: Promise<void> = Promise.resolve();

  constructor(
    filePath = './data/queue.json',
    concurrency = 1,
    private readonly retryBaseDelayMs = 1_000,
    private readonly retentionDays = 7,
    private readonly maxJobs = 1_000,
  ) {
    this.filePath = filePath;
    this.concurrency = concurrency;
    this.ensureDirectory();
    this.loadFromDisk();
  }

  private ensureDirectory(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(this.filePath)) {
      this.saveToDiskSync();
      return;
    }

    try {
      const content = fs.readFileSync(this.filePath, 'utf-8');
      if (!content.trim()) {
        throw new Error('Arquivo da fila está vazio');
      }

      const parsed: unknown = JSON.parse(content);
      if (!Array.isArray(parsed) || !parsed.every(isStoredLeadJob)) {
        throw new Error('Estrutura inválida no arquivo da fila');
      }
      if (new Set(parsed.map((job) => job.id)).size !== parsed.length) {
        throw new Error('Arquivo da fila contém IDs de job duplicados');
      }
      const rawJobs = parsed;
      let recoveredState = false;
      for (const job of rawJobs) {
        if (job.data) {
          const normalizedData = duotalkLeadDataSchema.parse(job.data);
          if (JSON.stringify(normalizedData) !== JSON.stringify(job.data)) recoveredState = true;
          job.data = normalizedData;
        }
        if (!job.target && (job.status === 'pending' || job.status === 'processing')) {
          job.status = 'failed';
          job.error = 'Job legado sem companyId; reenvie após confirmar a unidade no Syonet';
          job.errorCode = SYONET_COMPANY_ACCESS_DENIED;
          job.updatedAt = new Date().toISOString();
          delete job.credentialEnvelope;
          recoveredState = true;
        }
        // Não é seguro repetir: o processo pode ter caído depois de uma escrita no CRM.
        else if (job.status === 'processing') {
          job.status = 'failed';
          job.error =
            'Processamento interrompido com resultado ambíguo; exige conciliação no Syonet';
          job.updatedAt = new Date().toISOString();
          delete job.credentialEnvelope;
          recoveredState = true;
          logger.error(
            { jobId: job.id },
            'Job interrompido recuperado como falha ambígua para evitar escrita duplicada',
          );
        } else if (
          (job.status === 'completed' || job.status === 'failed') &&
          job.credentialEnvelope
        ) {
          delete job.credentialEnvelope;
          recoveredState = true;
        }
        if ((job.status === 'completed' || job.status === 'failed') && job.data) {
          delete job.data;
          recoveredState = true;
        }
        this.jobs.set(job.id, job);
      }
      logger.info(
        { totalLoaded: this.jobs.size, filePath: this.filePath },
        'Fila persistida em disco carregada',
      );
      if (this.purgeExpiredJobs() || recoveredState) this.saveToDiskSync();
    } catch (err) {
      logger.error({ err, filePath: this.filePath }, 'Erro ao carregar fila de arquivo');
      throw new Error('Não foi possível carregar a fila persistida com segurança', { cause: err });
    }
  }

  private saveToDiskSync(): void {
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    let temporaryFileDescriptor: number | undefined;
    try {
      const list = Array.from(this.jobs.values());
      temporaryFileDescriptor = fs.openSync(temporaryPath, 'w', 0o600);
      fs.writeFileSync(temporaryFileDescriptor, JSON.stringify(list, null, 2), 'utf-8');
      fs.fsyncSync(temporaryFileDescriptor);
      fs.closeSync(temporaryFileDescriptor);
      temporaryFileDescriptor = undefined;
      fs.renameSync(temporaryPath, this.filePath);
    } catch (err) {
      if (temporaryFileDescriptor !== undefined) fs.closeSync(temporaryFileDescriptor);
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
      logger.error({ err, filePath: this.filePath }, 'Erro ao salvar fila em disco');
      throw err;
    }
  }

  private async writeCurrentStateToDisk(): Promise<void> {
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    let temporaryFile: fs.promises.FileHandle | undefined;
    try {
      const serializedJobs = JSON.stringify(Array.from(this.jobs.values()));
      temporaryFile = await fs.promises.open(temporaryPath, 'w', 0o600);
      await temporaryFile.writeFile(serializedJobs, 'utf-8');
      await temporaryFile.sync();
      await temporaryFile.close();
      temporaryFile = undefined;
      await fs.promises.rename(temporaryPath, this.filePath);
    } catch (err) {
      await temporaryFile?.close().catch(() => undefined);
      await fs.promises.unlink(temporaryPath).catch(() => undefined);
      logger.error({ err, filePath: this.filePath }, 'Erro ao salvar fila em disco');
      throw err;
    }
  }

  private async saveToDisk(): Promise<void> {
    const persistence = this.persistenceChain.then(() => this.writeCurrentStateToDisk());
    this.persistenceChain = persistence.catch(() => undefined);
    await persistence;
  }

  async enqueue(
    data: DuotalkLeadData,
    credentialEnvelope: EncryptedCredentialEnvelope,
    target: SyonetTarget,
    dedupKey?: string,
  ): Promise<LeadJob> {
    const previousJobs = new Map(this.jobs);
    this.purgeExpiredJobs();
    this.ensureCapacity();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const job: LeadJob = {
      id,
      data,
      target,
      credentialEnvelope,
      dedupKey,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(id, job);
    try {
      await this.saveToDisk();
    } catch (error: unknown) {
      this.jobs = previousJobs;
      throw error;
    }
    logger.info({ jobId: id, driver: this.name }, 'Job enfileirado e salvo em arquivo');
    this.triggerProcessing();
    return job;
  }

  async getJob(id: string): Promise<LeadJob | null> {
    if (this.purgeExpiredJobs()) await this.saveToDisk();
    return this.jobs.get(id) || null;
  }

  async findDuplicate(dedupKey: string, windowMinutes = 5): Promise<LeadJob | null> {
    if (this.purgeExpiredJobs()) await this.saveToDisk();
    if (!dedupKey) return null;
    const now = Date.now();
    const windowMs = windowMinutes * 60 * 1000;

    for (const job of this.jobs.values()) {
      if (job.dedupKey === dedupKey) {
        if (job.status === 'failed' && isSyonetConfigurationErrorCode(job.errorCode)) continue;
        const jobTime = new Date(
          job.status === 'completed' || job.status === 'failed' ? job.updatedAt : job.createdAt,
        ).getTime();
        const age = now - jobTime;

        if (
          job.status === 'pending' ||
          job.status === 'processing' ||
          (age <= windowMs && (job.status === 'completed' || job.status === 'failed'))
        ) {
          return job;
        }
      }
    }
    return null;
  }

  async getStats(): Promise<QueueStats> {
    if (this.purgeExpiredJobs()) await this.saveToDisk();
    let pending = 0;
    let processing = 0;
    let completed = 0;
    let failed = 0;

    for (const job of this.jobs.values()) {
      if (job.status === 'pending') pending++;
      else if (job.status === 'processing') processing++;
      else if (job.status === 'completed') completed++;
      else if (job.status === 'failed') failed++;
    }

    return {
      pending,
      processing,
      completed,
      failed,
      total: this.jobs.size,
      driver: this.name,
    };
  }

  process(processor: JobProcessor): void {
    this.processor = processor;
    this.triggerProcessing();
  }

  pause(): void {
    this.processor = undefined;
  }

  hasWorker(): boolean {
    return Boolean(this.processor);
  }

  async waitForIdle(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (
      this.activeCount > 0 ||
      (this.processor && Array.from(this.jobs.values()).some((job) => job.status === 'pending'))
    ) {
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return true;
  }

  private async triggerProcessing(): Promise<void> {
    if (!this.processor) return;

    while (this.activeCount < this.concurrency) {
      const processor = this.processor;
      if (!processor) break;
      const pendingJob = Array.from(this.jobs.values()).find((j) => j.status === 'pending');
      if (!pendingJob) break;

      this.activeCount++;
      pendingJob.status = 'processing';
      pendingJob.attempts++;
      pendingJob.updatedAt = new Date().toISOString();
      try {
        await this.saveToDisk();
      } catch {
        pendingJob.status = 'pending';
        pendingJob.attempts--;
        this.activeCount--;
        setTimeout(() => this.triggerProcessing(), this.retryBaseDelayMs);
        break;
      }

      this.runJob(pendingJob, processor).finally(() => {
        this.activeCount--;
        this.triggerProcessing();
      });
    }
  }

  private async runJob(job: LeadJob, processor: JobProcessor): Promise<void> {
    logger.info({ jobId: job.id, attempt: job.attempts }, 'Iniciando processamento do job');
    try {
      const result = await processor(job);
      if (result) job.result = result;
      job.status = 'completed';
      delete job.error;
      delete job.errorCode;
      delete job.credentialEnvelope;
      delete job.data;
      job.updatedAt = new Date().toISOString();
      try {
        await this.saveToDisk();
      } catch (persistenceError: unknown) {
        logger.fatal(
          { err: persistenceError, jobId: job.id },
          'CRM processado, mas não foi possível persistir o resultado; o job não será repetido',
        );
      }
      logger.info({ jobId: job.id }, 'Job concluído com sucesso');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (err instanceof NonRetryableJobError && err.code) job.errorCode = err.code;
      else delete job.errorCode;
      logger.error(
        { jobId: job.id, attempt: job.attempts, err: errorMessage },
        'Erro no processamento do job',
      );

      if (!(err instanceof NonRetryableJobError) && job.attempts < job.maxAttempts) {
        await new Promise((resolve) =>
          setTimeout(resolve, this.retryBaseDelayMs * 2 ** (job.attempts - 1)),
        );
        job.status = 'pending';
        job.error = errorMessage;
        job.updatedAt = new Date().toISOString();
      } else {
        job.status = 'failed';
        job.error = errorMessage;
        delete job.credentialEnvelope;
        delete job.data;
        job.updatedAt = new Date().toISOString();
        logger.error(
          { jobId: job.id, nonRetryable: err instanceof NonRetryableJobError },
          'Job encerrado sem nova tentativa',
        );
      }
      try {
        await this.saveToDisk();
      } catch (persistenceError: unknown) {
        logger.fatal(
          { err: persistenceError, jobId: job.id },
          'Não foi possível persistir o estado do job após falha de processamento',
        );
      }
    }
  }

  private purgeExpiredJobs(): boolean {
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1_000;
    let changed = false;
    for (const [id, job] of this.jobs) {
      if (
        (job.status === 'completed' || job.status === 'failed') &&
        new Date(job.updatedAt).getTime() < cutoff
      ) {
        this.jobs.delete(id);
        changed = true;
      }
    }
    return changed;
  }

  private ensureCapacity(): void {
    while (this.jobs.size >= this.maxJobs) {
      const oldestTerminalJob = Array.from(this.jobs.values())
        .filter((job) => job.status === 'completed' || job.status === 'failed')
        .sort((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt))[0];
      if (!oldestTerminalJob) throw new QueueCapacityError();
      this.jobs.delete(oldestTerminalJob.id);
    }
  }
}

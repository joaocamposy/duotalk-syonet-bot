import crypto from 'node:crypto';
import { DuotalkLeadData } from '../../types/lead-request.js';
import { JobProcessor, QueueDriver, QueueStats, LeadJob } from '../types.js';
import { logger } from '../../utils/logger.js';
import { EncryptedCredentialEnvelope } from '../../integrations/syonet/credentials.js';
import { NonRetryableJobError, QueueCapacityError } from '../job-errors.js';
import { isSyonetConfigurationErrorCode } from '../../integrations/syonet/errors.js';
import { SyonetTarget } from '../../integrations/syonet/target.js';

export class MemoryQueueDriver implements QueueDriver {
  public name = 'memory';
  private jobs: Map<string, LeadJob> = new Map();
  private concurrency: number;
  private activeCount = 0;
  private processor?: JobProcessor;

  constructor(
    concurrency = 1,
    private readonly retryBaseDelayMs = 1_000,
    private readonly retentionDays = 7,
    private readonly maxJobs = 1_000,
  ) {
    this.concurrency = concurrency;
  }

  async enqueue(
    data: DuotalkLeadData,
    credentialEnvelope: EncryptedCredentialEnvelope,
    target: SyonetTarget,
    dedupKey?: string,
  ): Promise<LeadJob> {
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
    logger.info({ jobId: id, driver: this.name }, 'Job enfileirado na memória');
    this.triggerProcessing();
    return job;
  }

  async getJob(id: string): Promise<LeadJob | null> {
    this.purgeExpiredJobs();
    return this.jobs.get(id) || null;
  }

  async findDuplicate(dedupKey: string, windowMinutes = 5): Promise<LeadJob | null> {
    this.purgeExpiredJobs();
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

        // Se o job está pendente/em processamento OU se foi concluído/falhou dentro da janela
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
    this.purgeExpiredJobs();
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
    }
  }

  private purgeExpiredJobs(): void {
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1_000;
    for (const [id, job] of this.jobs) {
      if (
        (job.status === 'completed' || job.status === 'failed') &&
        new Date(job.updatedAt).getTime() < cutoff
      ) {
        this.jobs.delete(id);
      }
    }
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

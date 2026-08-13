import crypto from 'node:crypto';
import { DuotalkLeadData } from '../../types/duotalk-payload.js';
import { JobProcessor, QueueDriver, QueueStats, LeadJob } from '../types.js';
import { logger } from '../../utils/logger.js';

export class MemoryQueueDriver implements QueueDriver {
  public name = 'memory';
  private jobs: Map<string, LeadJob> = new Map();
  private concurrency: number;
  private activeCount = 0;
  private processor?: JobProcessor;

  constructor(concurrency = 1) {
    this.concurrency = concurrency;
  }

  async enqueue(data: DuotalkLeadData, dedupKey?: string): Promise<LeadJob> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const job: LeadJob = {
      id,
      data,
      dedupKey,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(id, job);
    logger.info({ jobId: id, driver: this.name, dedupKey }, 'Job enfileirado na memória');
    this.triggerProcessing();
    return job;
  }

  async getJob(id: string): Promise<LeadJob | null> {
    return this.jobs.get(id) || null;
  }

  async findDuplicate(dedupKey: string, windowMinutes = 5): Promise<LeadJob | null> {
    if (!dedupKey) return null;
    const now = Date.now();
    const windowMs = windowMinutes * 60 * 1000;

    for (const job of this.jobs.values()) {
      if (job.dedupKey === dedupKey) {
        const jobTime = new Date(job.createdAt).getTime();
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

  hasWorker(): boolean {
    return Boolean(this.processor);
  }

  private async triggerProcessing(): Promise<void> {
    if (!this.processor) return;

    while (this.activeCount < this.concurrency) {
      const pendingJob = Array.from(this.jobs.values()).find((j) => j.status === 'pending');
      if (!pendingJob) break;

      this.activeCount++;
      pendingJob.status = 'processing';
      pendingJob.attempts++;
      pendingJob.updatedAt = new Date().toISOString();

      this.runJob(pendingJob).finally(() => {
        this.activeCount--;
        this.triggerProcessing();
      });
    }
  }

  private async runJob(job: LeadJob): Promise<void> {
    logger.info({ jobId: job.id, attempt: job.attempts }, 'Iniciando processamento do job');
    try {
      if (this.processor) {
        await this.processor(job);
      }
      job.status = 'completed';
      job.updatedAt = new Date().toISOString();
      logger.info({ jobId: job.id }, 'Job concluído com sucesso');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(
        { jobId: job.id, attempt: job.attempts, err: errorMessage },
        'Erro no processamento do job',
      );

      if (job.attempts < job.maxAttempts) {
        job.status = 'pending';
        job.error = errorMessage;
        job.updatedAt = new Date().toISOString();
      } else {
        job.status = 'failed';
        job.error = errorMessage;
        job.updatedAt = new Date().toISOString();
        logger.error(
          { jobId: job.id },
          'Job falhou permanentemente após atingir limite de retentativas',
        );
      }
    }
  }
}

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DuotalkLeadData } from '../../types/duotalk-payload.js';
import { JobProcessor, QueueDriver, QueueStats, LeadJob } from '../types.js';
import { logger } from '../../utils/logger.js';

export class FileQueueDriver implements QueueDriver {
  public name = 'file';
  private filePath: string;
  private concurrency: number;
  private jobs: Map<string, LeadJob> = new Map();
  private activeCount = 0;
  private processor?: JobProcessor;

  constructor(filePath = './data/queue.json', concurrency = 1) {
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
      this.saveToDisk();
      return;
    }

    try {
      const content = fs.readFileSync(this.filePath, 'utf-8');
      if (!content.trim()) return;

      const rawJobs: LeadJob[] = JSON.parse(content);
      for (const job of rawJobs) {
        // Se a aplicação caiu enquanto o job estava rodando, reseta para 'pending'
        if (job.status === 'processing') {
          job.status = 'pending';
          logger.warn(
            { jobId: job.id },
            'Job interrompido por crash restaurado para status pending',
          );
        }
        this.jobs.set(job.id, job);
      }
      logger.info(
        { totalLoaded: this.jobs.size, filePath: this.filePath },
        'Fila persistida em disco carregada',
      );
    } catch (err) {
      logger.error({ err, filePath: this.filePath }, 'Erro ao carregar fila de arquivo');
    }
  }

  private saveToDisk(): void {
    try {
      const list = Array.from(this.jobs.values());
      fs.writeFileSync(this.filePath, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err) {
      logger.error({ err, filePath: this.filePath }, 'Erro ao salvar fila em disco');
    }
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
    this.saveToDisk();
    logger.info({ jobId: id, driver: this.name, dedupKey }, 'Job enfileirado e salvo em arquivo');
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
      this.saveToDisk();

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
      this.saveToDisk();
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
      this.saveToDisk();
    }
  }
}

import { DuotalkLeadData } from '../types/duotalk-payload.js';

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface LeadJob {
  id: string;
  data: DuotalkLeadData;
  dedupKey?: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
  driver: string;
}

export type JobProcessor = (job: LeadJob) => Promise<void>;

export interface QueueDriver {
  name: string;
  enqueue(data: DuotalkLeadData, dedupKey?: string): Promise<LeadJob>;
  getJob(id: string): Promise<LeadJob | null>;
  findDuplicate(dedupKey: string, windowMinutes?: number): Promise<LeadJob | null>;
  getStats(): Promise<QueueStats>;
  process(processor: JobProcessor): void;
  hasWorker(): boolean;
}

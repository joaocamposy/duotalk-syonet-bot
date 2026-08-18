import { DuotalkLeadData } from '../types/duotalk-payload.js';
import { EncryptedCredentialEnvelope } from '../credentials/credential-envelope.js';
import { SyonetTarget } from '../types/syonet-target.js';

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface LeadJobResult {
  clientCreated: boolean;
  clientId: number | null;
  companyId: number;
  dryRun: boolean;
  eventId: number | null;
  mapping?: {
    contactForm: string;
    eventGroupId: string;
    eventTypeId: string;
    media: string;
  };
}

export interface LeadJob {
  id: string;
  data?: DuotalkLeadData;
  target?: SyonetTarget;
  credentialEnvelope?: EncryptedCredentialEnvelope;
  dedupKey?: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  error?: string;
  errorCode?: string;
  result?: LeadJobResult;
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

export type JobProcessor = (job: LeadJob) => Promise<LeadJobResult | void>;

export interface QueueDriver {
  name: string;
  enqueue(
    data: DuotalkLeadData,
    credentialEnvelope: EncryptedCredentialEnvelope,
    target: SyonetTarget,
    dedupKey?: string,
  ): Promise<LeadJob>;
  getJob(id: string): Promise<LeadJob | null>;
  findDuplicate(dedupKey: string, windowMinutes?: number): Promise<LeadJob | null>;
  getStats(): Promise<QueueStats>;
  process(processor: JobProcessor): void;
  pause(): void;
  hasWorker(): boolean;
  waitForIdle(timeoutMs: number): Promise<boolean>;
}

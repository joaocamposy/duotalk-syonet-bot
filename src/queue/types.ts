import { DuotalkLeadData } from '../types/lead-request.js';
import { EncryptedCredentialEnvelope } from '../integrations/syonet/credentials.js';
import { SyonetTarget } from '../integrations/syonet/target.js';

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface LeadJobResult {
  clientCreated: boolean;
  clientUpdated: boolean;
  clientId: number | null;
  companyId: number;
  dryRun: boolean;
  eventCreated: boolean;
  eventId: number | null;
  mapping: {
    contactForm: string;
    eventGroupId: string;
    eventTypeId: string;
    media: string;
  };
}

export interface LeadJob {
  id: string;
  data?: DuotalkLeadData;
  dryRun?: boolean;
  daysToUpdateOpenEvent?: number;
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
    dryRun?: boolean,
    daysToUpdateOpenEvent?: number,
  ): Promise<LeadJob>;
  getJob(id: string): Promise<LeadJob | null>;
  findDuplicate(dedupKey: string, windowMinutes?: number): Promise<LeadJob | null>;
  getStats(): Promise<QueueStats>;
  process(processor: JobProcessor): void;
  pause(): void;
  hasWorker(): boolean;
  waitForIdle(timeoutMs: number): Promise<boolean>;
}

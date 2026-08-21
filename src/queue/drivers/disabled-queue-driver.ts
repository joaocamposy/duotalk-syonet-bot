import { EncryptedCredentialEnvelope } from '../../integrations/syonet/credentials.js';
import { DuotalkLeadData } from '../../types/lead-request.js';
import { SyonetTarget } from '../../integrations/syonet/target.js';
import { LeadJob, JobProcessor, QueueDriver, QueueStats } from '../types.js';

export class DisabledQueueDriver implements QueueDriver {
  readonly name = 'disabled';

  async enqueue(
    _data: DuotalkLeadData,
    _credentialEnvelope: EncryptedCredentialEnvelope,
    _target: SyonetTarget,
    _dedupKey?: string,
    _dryRun?: boolean,
    _daysToUpdateOpenEvent?: number,
  ): Promise<LeadJob> {
    void _data;
    void _credentialEnvelope;
    void _target;
    void _dedupKey;
    void _dryRun;
    void _daysToUpdateOpenEvent;
    throw new Error('Fila desativada por configuração');
  }

  async getJob(_id: string): Promise<LeadJob | null> {
    void _id;
    return null;
  }

  async findDuplicate(_dedupKey: string, _windowMinutes?: number): Promise<LeadJob | null> {
    void _dedupKey;
    void _windowMinutes;
    return null;
  }

  async getStats(): Promise<QueueStats> {
    return {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      total: 0,
      driver: this.name,
    };
  }

  process(_processor: JobProcessor): void {
    void _processor;
  }

  pause(): void {}

  hasWorker(): boolean {
    return false;
  }

  async waitForIdle(_timeoutMs: number): Promise<boolean> {
    void _timeoutMs;
    return true;
  }
}

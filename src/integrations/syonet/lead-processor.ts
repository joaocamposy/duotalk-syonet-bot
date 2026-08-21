import { decryptCredentials } from './credentials.js';
import type { SyonetCredentials } from './credentials.js';
import { LeadJob } from '../../queue/types.js';
import { NonRetryableJobError } from '../../queue/job-errors.js';
import { SYONET_COMPANY_ACCESS_DENIED } from './errors.js';
import { logger } from '../../utils/logger.js';
import { LeadProcessResult, processLeadViaApi } from './api-client.js';

export async function processLeadJob(job: LeadJob): Promise<LeadProcessResult> {
  logger.info(
    {
      jobId: job.id,
    },
    'Iniciando processamento do lead Syonet',
  );

  if (!job.credentialEnvelope) {
    throw new NonRetryableJobError('O job não possui credenciais disponíveis para processamento');
  }
  if (!job.target) {
    throw new NonRetryableJobError('O job não possui companyId para validar a unidade do Syonet', {
      code: SYONET_COMPANY_ACCESS_DENIED,
    });
  }
  if (!job.data) {
    throw new NonRetryableJobError('O job não possui dados do lead para processamento');
  }
  let credentials: SyonetCredentials;
  try {
    credentials = decryptCredentials(job.credentialEnvelope);
  } catch (error: unknown) {
    throw new NonRetryableJobError('Não foi possível descriptografar as credenciais do job', {
      cause: error,
    });
  }
  const result = await processLeadViaApi(job.data, credentials, job.target, undefined, {
    dryRun: job.dryRun ?? false,
    daysToUpdateOpenEvent: job.daysToUpdateOpenEvent ?? 0,
  });
  logger.info({ jobId: job.id, ...result }, 'Fluxo HTTP do Syonet concluído com sucesso');
  return result;
}

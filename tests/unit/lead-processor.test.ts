import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { LeadJob, LeadJobResult } from '../../src/queue/types.js';

describe('lead job processor', () => {
  const processViaApi = vi.fn<() => Promise<LeadJobResult>>();
  const originalEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  let makeJob: () => LeadJob;
  let processLeadJob: (job: LeadJob) => Promise<LeadJobResult>;

  beforeAll(async () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    vi.resetModules();
    vi.doMock('../../src/integrations/syonet/api-client.js', () => ({
      processLeadViaApi: processViaApi,
    }));

    const [{ encryptCredentials }, processor] = await Promise.all([
      import('../../src/integrations/syonet/credentials.js'),
      import('../../src/integrations/syonet/lead-processor.js'),
    ]);
    processLeadJob = processor.processLeadJob;
    makeJob = () => ({
      id: 'job-processor-test',
      data: {
        idConversa: 'processor-conversation',
        nome: 'Teste Processor',
        telefone: '5561999998888',
        origem: 'Outbound',
        canal: 'WhatsApp 360',
        qualificacaoLead: 'Lead',
        intermediario: 'Duotalk',
      },
      dryRun: true,
      target: { companyId: 25 },
      credentialEnvelope: encryptCredentials({
        url: 'https://crm.example.com',
        username: 'usuario',
        password: 'senha',
      }),
      status: 'processing',
      attempts: 1,
      maxAttempts: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  afterAll(() => {
    if (originalEncryptionKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey;
    vi.doUnmock('../../src/integrations/syonet/api-client.js');
  });

  it('descriptografa o job e encaminha o modo dry-run para a integração', async () => {
    const expected: LeadJobResult = {
      clientCreated: false,
      clientUpdated: false,
      clientId: null,
      companyId: 25,
      dryRun: true,
      eventCreated: false,
      eventId: null,
      mapping: {
        contactForm: 'WHATSAPP',
        eventGroupId: 'OPORTUNIDADE',
        eventTypeId: 'NOVOS WEB',
        media: 'DUOTALK',
      },
    };
    processViaApi.mockResolvedValueOnce(expected);
    const job = makeJob();

    await expect(processLeadJob(job)).resolves.toEqual(expected);
    expect(processViaApi).toHaveBeenCalledWith(
      job.data,
      {
        url: 'https://crm.example.com',
        username: 'usuario',
        password: 'senha',
      },
      job.target,
      undefined,
      { dryRun: true, daysToUpdateOpenEvent: 0 },
    );
  });

  it('recusa job sem os campos necessários antes de chamar a integração', async () => {
    const job = makeJob();
    delete job.credentialEnvelope;
    await expect(processLeadJob(job)).rejects.toThrow('não possui credenciais');

    const withoutTarget = makeJob();
    delete withoutTarget.target;
    await expect(processLeadJob(withoutTarget)).rejects.toThrow('não possui companyId');

    const withoutData = makeJob();
    delete withoutData.data;
    await expect(processLeadJob(withoutData)).rejects.toThrow('não possui dados');
  });
});

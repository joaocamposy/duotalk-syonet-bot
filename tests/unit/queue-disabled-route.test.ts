import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

describe('queue disabled response', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.QUEUE_ENABLED = 'false';
    process.env.QUEUE_DRIVER = 'file';
    process.env.API_TOKEN = 'queue-disabled-route-token';
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');

    const apiClient = await import('../../src/integrations/syonet/api-client.js');
    vi.spyOn(apiClient, 'processLeadViaApi').mockResolvedValue({
      clientCreated: true,
      clientUpdated: false,
      clientId: 10,
      companyId: 25,
      dryRun: false,
      eventCreated: true,
      eventId: 20,
      mapping: {
        contactForm: 'WHATSAPP',
        eventGroupId: 'OPORTUNIDADE',
        eventTypeId: 'NOVOS WEB',
        media: 'DUOTALK',
      },
    });
    const { buildApp } = await import('../../src/app.js');
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('processa diretamente por padrão sem criar job', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/leads',
      headers: { authorization: 'Bearer queue-disabled-route-token' },
      payload: {
        credentials: {
          url: 'https://crm.example.com',
          username: 'usuario',
          password: 'senha',
        },
        target: { companyId: 25 },
        data: {
          idConversa: 'queue-disabled-direct-test',
          nome: 'Teste de fila desativada',
          telefone: '5561999998888',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      status: 'completed',
      result: { clientId: 10, eventId: 20 },
    });
    expect(response.json()).not.toHaveProperty('jobId');
  });

  it('responde 503 quando o consumidor pede explicitamente o modo assíncrono', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/leads?sync=false',
      headers: { authorization: 'Bearer queue-disabled-route-token' },
      payload: {
        credentials: {
          url: 'https://crm.example.com',
          username: 'usuario',
          password: 'senha',
        },
        target: { companyId: 25 },
        data: {
          idConversa: 'queue-disabled-async-test',
          nome: 'Teste assíncrono sem fila',
          telefone: '5561999998888',
        },
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      success: false,
      message: 'Processamento assíncrono indisponível: fila desativada por configuração',
    });
    expect(response.json()).not.toHaveProperty('jobId');
  });

  it('retorna erro de configuração do Syonet diretamente no modo síncrono', async () => {
    const [{ processLeadViaApi }, { NonRetryableJobError }] = await Promise.all([
      import('../../src/integrations/syonet/api-client.js'),
      import('../../src/queue/job-errors.js'),
    ]);
    vi.mocked(processLeadViaApi).mockRejectedValueOnce(
      new NonRetryableJobError('Unidade incompatível', {
        code: 'SYONET_COMPANY_ACCESS_DENIED',
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/leads',
      headers: { authorization: 'Bearer queue-disabled-route-token' },
      payload: {
        credentials: {
          url: 'https://crm.example.com',
          username: 'usuario',
          password: 'senha',
        },
        target: { companyId: 99 },
        data: {
          idConversa: 'queue-disabled-company-test',
          nome: 'Teste de unidade sem fila',
          telefone: '5561999998888',
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      success: false,
      status: 'failed',
      errorCode: 'SYONET_COMPANY_ACCESS_DENIED',
    });
    expect(response.json()).not.toHaveProperty('jobId');
  });

  it('expõe o driver como disabled sem inicializar a fila configurada', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/queue/status',
      headers: { authorization: 'Bearer queue-disabled-route-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      stats: { driver: 'disabled', total: 0 },
    });
  });
});

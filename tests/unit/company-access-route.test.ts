import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

describe('Syonet configuration error responses', () => {
  let app: FastifyInstance;
  let failureCode = 'SYONET_COMPANY_ACCESS_DENIED';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.QUEUE_DRIVER = 'memory';
    process.env.API_TOKEN = 'company-access-route-token';
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');

    const [{ buildApp }, { queueInstance }, { NonRetryableJobError }] = await Promise.all([
      import('../../src/app.js'),
      import('../../src/queue/queue-manager.js'),
      import('../../src/queue/job-errors.js'),
    ]);
    app = buildApp({ startWorker: false });
    queueInstance.process(async () => {
      throw new NonRetryableJobError('Configuração incompatível com o tenant', {
        code: failureCode,
      });
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('retorna 422 e código estável no modo síncrono', async () => {
    failureCode = 'SYONET_COMPANY_ACCESS_DENIED';
    const response = await app.inject({
      method: 'POST',
      url: '/leads?sync=true',
      headers: { authorization: 'Bearer company-access-route-token' },
      payload: {
        credentials: {
          url: 'https://crm.example.com',
          username: 'usuario',
          password: 'senha',
        },
        target: { companyId: 99 },
        data: {
          idConversa: 'company-access-route-test',
          nome: 'Teste de unidade',
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

    const retry = await app.inject({
      method: 'POST',
      url: '/leads?sync=true',
      headers: { authorization: 'Bearer company-access-route-token' },
      payload: {
        credentials: {
          url: 'https://crm.example.com',
          username: 'usuario',
          password: 'senha',
        },
        target: { companyId: 99 },
        data: {
          idConversa: 'company-access-route-test',
          nome: 'Teste de unidade',
          telefone: '5561999998888',
        },
      },
    });

    expect(retry.statusCode).toBe(422);
    expect(retry.json().jobId).not.toBe(response.json().jobId);
  });

  it('também retorna 422 quando falta um de/para confirmado', async () => {
    failureCode = 'SYONET_EVENT_TYPE_MAPPING_NOT_FOUND';
    const response = await app.inject({
      method: 'POST',
      url: '/leads?sync=true',
      headers: { authorization: 'Bearer company-access-route-token' },
      payload: {
        credentials: {
          url: 'https://crm.example.com',
          username: 'usuario',
          password: 'senha',
        },
        target: { companyId: 99 },
        data: {
          idConversa: 'mapping-error-route-test',
          nome: 'Teste de de/para',
          telefone: '5561999998888',
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      success: false,
      status: 'failed',
      errorCode: 'SYONET_EVENT_TYPE_MAPPING_NOT_FOUND',
    });
  });
});

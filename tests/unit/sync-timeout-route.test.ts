import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

describe('sync timeout response', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.QUEUE_DRIVER = 'memory';
    process.env.API_TOKEN = 'sync-timeout-route-token';
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    process.env.SYNC_TIMEOUT_MS = '1';

    const [{ buildApp }, { queueInstance }] = await Promise.all([
      import('../../src/app.js'),
      import('../../src/queue/queue-manager.js'),
    ]);
    app = buildApp({ startWorker: false });
    queueInstance.process(() => new Promise(() => undefined));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 504 com jobId quando o prazo síncrono termina', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/leads?sync=true',
      headers: { authorization: 'Bearer sync-timeout-route-token' },
      payload: {
        credentials: {
          url: 'https://crm.example.com',
          username: 'usuario',
          password: 'senha',
        },
        target: { companyId: 25 },
        data: {
          idConversa: 'sync-timeout-route-test',
          nome: 'Teste de timeout',
          telefone: '5561999998888',
        },
      },
    });

    expect(response.statusCode).toBe(504);
    expect(response.json()).toMatchObject({
      success: false,
      status: 'processing',
    });
    expect(response.json().jobId).toEqual(expect.any(String));
  });
});

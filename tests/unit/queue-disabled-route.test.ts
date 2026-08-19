import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

describe('queue disabled response', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.QUEUE_ENABLED = 'false';
    process.env.QUEUE_DRIVER = 'file';
    process.env.API_TOKEN = 'queue-disabled-route-token';
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');

    const { buildApp } = await import('../../src/app.js');
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 503 sem jobId antes de verificar o worker', async () => {
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
          nome: 'Teste de fila desativada',
          telefone: '5561999998888',
        },
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      success: false,
      message: 'Processamento indisponível: fila desativada por configuração',
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

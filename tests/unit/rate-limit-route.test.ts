import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

describe('rate limit response', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.QUEUE_DRIVER = 'memory';
    process.env.API_TOKEN = 'rate-limit-route-token';
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const { buildApp } = await import('../../src/app.js');
    app = buildApp({ startWorker: false, rateLimitMax: 1 });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('mantém HTTP 429 ao personalizar o corpo da resposta', async () => {
    const request = (forwardedFor: string) =>
      app.inject({
        method: 'GET',
        url: '/queue/status',
        headers: {
          authorization: 'Bearer rate-limit-route-token',
          'x-forwarded-for': forwardedFor,
        },
      });

    expect((await request('203.0.113.1')).statusCode).toBe(200);
    const limited = await request('203.0.113.2');

    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({
      success: false,
    });
    expect(limited.json().message).toContain('Limite de requisições excedido');
  });

  it('não cria novos limites ao variar o formato ou o valor do Bearer', async () => {
    const request = (authorization: string, forwardedFor: string) =>
      app.inject({
        method: 'GET',
        url: '/queue/status',
        headers: { authorization, 'x-forwarded-for': forwardedFor },
      });

    expect((await request('bearer   rate-limit-route-token', '203.0.113.10')).statusCode).toBe(429);
    expect((await request('Bearer token-invalido-a', '203.0.113.20')).statusCode).toBe(401);
    expect((await request('Bearer token-invalido-b', '203.0.113.20')).statusCode).toBe(429);
  });
});

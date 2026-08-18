import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

describe('HTTP routes', () => {
  let app: FastifyInstance;

  const payload = {
    credentials: {
      url: 'https://crm.example.com',
      username: 'usuario-nao-expor',
      password: 'senha-nao-expor',
      version: '1',
    },
    target: { companyId: 25 },
    data: {
      idConversa: 'route-test-conversation',
      nome: 'Teste das rotas',
      telefone: '5561999998888',
      dryRun: true,
    },
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.QUEUE_DRIVER = 'memory';
    process.env.QUEUE_MAX_JOBS = '7';
    process.env.MICROSERVICE_API_TOKEN = 'route-test-token';
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const { buildApp } = await import('../../src/app.js');
    app = buildApp({ startWorker: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('protege webhook e endpoints da fila com Bearer', async () => {
    const webhook = await app.inject({ method: 'POST', url: '/webhook/duotalk', payload });
    const queue = await app.inject({ method: 'GET', url: '/queue/status' });

    expect(webhook.statusCode).toBe(401);
    expect(queue.statusCode).toBe(401);
  });

  it('mantém o healthcheck público fora do rate limit operacional', async () => {
    const health = await app.inject({ method: 'GET', url: '/health' });

    expect(health.statusCode).toBe(200);
    expect(health.headers).not.toHaveProperty('x-ratelimit-limit');
  });

  it('permite desabilitar completamente o Swagger no deploy', async () => {
    const appWithoutDocs = (await import('../../src/app.js')).buildApp({
      exposeDocumentation: false,
      startWorker: false,
    });
    await appWithoutDocs.ready();

    expect((await appWithoutDocs.inject({ method: 'GET', url: '/docs' })).statusCode).toBe(404);
    expect((await appWithoutDocs.inject({ method: 'GET', url: '/docs/json' })).statusCode).toBe(
      404,
    );
    await appWithoutDocs.close();
  });

  it('responde 400 para payload inválido sem devolver a senha', async () => {
    const invalidPayload = {
      credentials: { ...payload.credentials, password: 'senha-que-nao-pode-voltar' },
      data: { nome: 'Sem campos obrigatórios' },
    };
    const response = await app.inject({
      method: 'POST',
      url: '/webhook/duotalk',
      headers: { authorization: 'Bearer route-test-token' },
      payload: invalidPayload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ success: false, message: 'Payload inválido' });
    expect(response.body).not.toContain(invalidPayload.credentials.password);
  });

  it('responde 400 para JSON malformado em vez de erro interno', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/webhook/duotalk',
      headers: {
        authorization: 'Bearer route-test-token',
        'content-type': 'application/json',
      },
      payload: '{"credentials":',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ success: false, message: 'Requisição HTTP inválida' });
  });

  it('enfileira com token válido sem expor credenciais ou dados pessoais na consulta', async () => {
    const authorization = 'Bearer route-test-token';
    const accepted = await app.inject({
      method: 'POST',
      url: '/webhook/duotalk',
      headers: { authorization },
      payload,
    });
    expect(accepted.statusCode).toBe(202);

    const details = await app.inject({
      method: 'GET',
      url: `/queue/jobs/${accepted.json().jobId}`,
      headers: { authorization },
    });
    expect(details.statusCode).toBe(200);
    expect(details.body).not.toContain(payload.credentials.username);
    expect(details.body).not.toContain(payload.credentials.password);
    expect(details.body).not.toContain('credentialEnvelope');
    expect(details.body).not.toContain('ciphertext');
    expect(details.body).not.toContain(payload.data.nome);
    expect(details.body).not.toContain(payload.data.telefone);
    expect(details.json().job).not.toHaveProperty('data');
    expect(details.json().job).not.toHaveProperty('target');
    expect(details.json().job).not.toHaveProperty('error');
  });

  it('retorna o job anterior quando a conversa é duplicada', async () => {
    const duplicate = await app.inject({
      method: 'POST',
      url: '/webhook/duotalk',
      headers: { authorization: 'Bearer route-test-token' },
      payload,
    });

    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({ duplicate: true, status: 'pending' });
  });

  it('não confunde dry-run com a gravação real da mesma conversa', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/webhook/duotalk',
      headers: { authorization: 'Bearer route-test-token' },
      payload: {
        ...payload,
        data: { ...payload.data, dryRun: false },
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).not.toMatchObject({ duplicate: true });
  });

  it('não persiste conversa, lead ou telefone em texto claro na chave de deduplicação', async () => {
    const [{ buildDedupKey }, { duotalkLeadDataSchema }] = await Promise.all([
      import('../../src/controllers/lead-controller.js'),
      import('../../src/types/duotalk-payload.js'),
    ]);
    const leadData = duotalkLeadDataSchema.parse(payload.data);
    const key = buildDedupKey(leadData, payload.credentials.url, payload.target);

    expect(key).not.toContain(payload.data.idConversa);
    expect(key).not.toContain(payload.data.telefone);
    expect(key).toMatch(/^[a-f0-9]{64}:(dry-run|write):[a-f0-9]{64}$/);

    const sharedDigits = payload.data.telefone;
    const conversationKey = buildDedupKey(
      { ...leadData, idConversa: sharedDigits },
      payload.credentials.url,
      payload.target,
    );
    const leadKey = buildDedupKey(
      { ...leadData, idConversa: undefined, id: sharedDigits },
      payload.credentials.url,
      payload.target,
    );
    const phoneKey = buildDedupKey(
      { ...leadData, idConversa: undefined, id: undefined },
      payload.credentials.url,
      payload.target,
    );
    expect(new Set([conversationKey, leadKey, phoneKey]).size).toBe(3);
    expect(phoneKey).not.toContain(sharedDigits);
  });

  it('separa os domínios de id da conversa e id do lead', async () => {
    const sharedId = 'mesmo-valor-em-dominios-diferentes';
    const request = (data: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: '/webhook/duotalk',
        headers: { authorization: 'Bearer route-test-token' },
        payload: { ...payload, data: { ...payload.data, idConversa: undefined, ...data } },
      });

    const conversation = await request({ idConversa: sharedId });
    const lead = await request({ id: sharedId });

    expect(conversation.statusCode).toBe(202);
    expect(lead.statusCode).toBe(202);
    expect(lead.json().jobId).not.toBe(conversation.json().jobId);
  });

  it('não confunde a mesma conversa entre tenants Syonet diferentes', async () => {
    const otherTenant = await app.inject({
      method: 'POST',
      url: '/webhook/duotalk',
      headers: { authorization: 'Bearer route-test-token' },
      payload: {
        ...payload,
        credentials: { ...payload.credentials, url: 'https://outro-crm.example.com' },
      },
    });

    expect(otherTenant.statusCode).toBe(202);
    expect(otherTenant.json()).not.toMatchObject({ duplicate: true });
  });

  it('não confunde a mesma conversa entre unidades diferentes do mesmo Syonet', async () => {
    const otherCompany = await app.inject({
      method: 'POST',
      url: '/webhook/duotalk',
      headers: { authorization: 'Bearer route-test-token' },
      payload: {
        ...payload,
        target: { companyId: 26 },
      },
    });

    expect(otherCompany.statusCode).toBe(202);
    expect(otherCompany.json()).not.toMatchObject({ duplicate: true });
  });

  it('serializa requisições concorrentes com a mesma chave de deduplicação', async () => {
    const concurrentPayload = {
      ...payload,
      data: { ...payload.data, idConversa: 'concurrent-route-test' },
    };
    const request = () =>
      app.inject({
        method: 'POST',
        url: '/webhook/duotalk',
        headers: { authorization: 'Bearer route-test-token' },
        payload: concurrentPayload,
      });

    const responses = await Promise.all([request(), request()]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 202]);
    expect(new Set(responses.map((response) => response.json().jobId)).size).toBe(1);
  });

  it('responde 503 quando a fila não pode aceitar outro job com segurança', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/webhook/duotalk',
      headers: { authorization: 'Bearer route-test-token' },
      payload: {
        ...payload,
        data: { ...payload.data, idConversa: 'queue-capacity-route-test' },
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      success: false,
      message: 'Fila temporariamente sem capacidade; tente novamente mais tarde',
    });
  });

  it('responde 409 para repetição de job falho que exige conciliação', async () => {
    const authorization = 'Bearer route-test-token';
    const existing = await app.inject({
      method: 'POST',
      url: '/webhook/duotalk',
      headers: { authorization },
      payload,
    });
    const { queueInstance } = await import('../../src/queue/queue-manager.js');
    const job = await queueInstance.getJob(existing.json().jobId);
    if (!job) throw new Error('Job usado no teste não foi localizado');
    job.status = 'failed';
    job.errorCode = undefined;
    job.updatedAt = new Date().toISOString();

    const duplicate = await app.inject({
      method: 'POST',
      url: '/webhook/duotalk',
      headers: { authorization },
      payload,
    });

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ success: false, duplicate: true, status: 'failed' });
  });

  it('aceita novo envio após falha de configuração corrigível', async () => {
    const authorization = 'Bearer route-test-token';
    const companyPayload = { ...payload, target: { companyId: 26 } };
    const existing = await app.inject({
      method: 'POST',
      url: '/webhook/duotalk',
      headers: { authorization },
      payload: companyPayload,
    });
    const { queueInstance } = await import('../../src/queue/queue-manager.js');
    const job = await queueInstance.getJob(existing.json().jobId);
    if (!job) throw new Error('Job usado no teste não foi localizado');
    job.status = 'failed';
    job.errorCode = 'SYONET_COMPANY_ACCESS_DENIED';
    job.updatedAt = new Date().toISOString();

    const corrected = await app.inject({
      method: 'POST',
      url: '/webhook/duotalk',
      headers: { authorization },
      payload: companyPayload,
    });

    expect(corrected.statusCode).toBe(202);
    expect(corrected.json().jobId).not.toBe(job.id);
  });
});

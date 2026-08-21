import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MemoryQueueDriver } from '../../src/queue/drivers/memory-queue-driver.js';
import { FileQueueDriver } from '../../src/queue/drivers/file-queue-driver.js';
import { DuotalkLeadData } from '../../src/types/lead-request.js';
import { NonRetryableJobError, QueueCapacityError } from '../../src/queue/job-errors.js';

const sampleLead: DuotalkLeadData = {
  nome: 'Teste Fila',
  telefone: '5561999998888',
  email: 'teste.fila@exemplo.com',
  origem: 'Outbound',
  canal: 'WhatsApp 360',
  qualificacaoLead: 'Lead',
  intermediario: 'Duotalk',
};

const credentialEnvelope = {
  algorithm: 'aes-256-gcm' as const,
  authTag: Buffer.alloc(16, 1).toString('base64'),
  ciphertext: Buffer.from('ciphertext').toString('base64'),
  iv: Buffer.alloc(12, 2).toString('base64'),
  version: 1 as const,
};
const target = { companyId: 25 };

describe('Queue Drivers (Memory & File)', () => {
  const testFilePath = path.join(process.cwd(), 'data', 'test-queue.json');

  beforeEach(() => {
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  });

  afterEach(() => {
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  });

  it('MemoryQueueDriver deve enfileirar e processar jobs com sucesso', async () => {
    const driver = new MemoryQueueDriver(1);
    const job = await driver.enqueue(sampleLead, credentialEnvelope, target, undefined, false, 30);

    expect(job.id).toBeDefined();
    expect(job.status).toBe('pending');
    expect(job.daysToUpdateOpenEvent).toBe(30);

    let processedJobId = '';
    driver.process(async (j) => {
      processedJobId = j.id;
      return {
        clientCreated: true,
        clientUpdated: false,
        clientId: -10,
        companyId: 25,
        dryRun: false,
        eventId: 20,
      };
    });

    // Aguarda o microtick de processamento
    await new Promise((resolve) => setTimeout(resolve, 50));

    const stats = await driver.getStats();
    expect(processedJobId).toBe(job.id);
    expect(stats.completed).toBe(1);
    expect((await driver.getJob(job.id))?.result).toEqual({
      clientCreated: true,
      clientUpdated: false,
      clientId: -10,
      companyId: 25,
      dryRun: false,
      eventId: 20,
    });
    expect((await driver.getJob(job.id))?.credentialEnvelope).toBeUndefined();
    expect((await driver.getJob(job.id))?.data).toBeUndefined();
  });

  it('FileQueueDriver deve enfileirar, salvar em disco e restaurar jobs pós-crash', async () => {
    const driver1 = new FileQueueDriver(testFilePath, 1);
    const job = await driver1.enqueue(sampleLead, credentialEnvelope, target, undefined, false, 30);

    expect(fs.existsSync(testFilePath)).toBe(true);

    // Instancia um segundo driver lendo o mesmo arquivo (simulando restart do servidor)
    const driver2 = new FileQueueDriver(testFilePath, 1);
    const restoredJob = await driver2.getJob(job.id);

    expect(restoredJob).not.toBeNull();
    expect(restoredJob?.id).toBe(job.id);
    expect(restoredJob?.data.nome).toBe('Teste Fila');
    expect(restoredJob?.credentialEnvelope).toEqual(credentialEnvelope);
    expect(restoredJob?.daysToUpdateOpenEvent).toBe(30);
    expect(fs.statSync(testFilePath).mode & 0o777).toBe(0o600);
  });

  it('migra dryRun legado para fora dos dados antes de processar o job', async () => {
    fs.mkdirSync(path.dirname(testFilePath), { recursive: true });
    fs.writeFileSync(
      testFilePath,
      JSON.stringify([
        {
          id: 'job-legado-dry-run',
          data: { ...sampleLead, dryRun: true },
          target,
          credentialEnvelope,
          status: 'pending',
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
      'utf8',
    );

    const driver = new FileQueueDriver(testFilePath, 1);
    const recovered = await driver.getJob('job-legado-dry-run');

    expect(recovered?.dryRun).toBe(true);
    expect(recovered?.data).not.toHaveProperty('dryRun');
    expect(JSON.parse(fs.readFileSync(testFilePath, 'utf8'))[0]).toMatchObject({ dryRun: true });
  });

  it('remove dados pessoais do arquivo quando o job termina', async () => {
    const driver = new FileQueueDriver(testFilePath, 1, 0);
    driver.process(async () => ({
      clientCreated: false,
      clientUpdated: false,
      clientId: -10,
      companyId: 25,
      dryRun: false,
      eventId: 20,
    }));
    const job = await driver.enqueue(sampleLead, credentialEnvelope, target);

    await expect(driver.waitForIdle(500)).resolves.toBe(true);
    const persisted = fs.readFileSync(testFilePath, 'utf8');
    expect((await driver.getJob(job.id))?.data).toBeUndefined();
    expect(persisted).not.toContain(sampleLead.nome);
    expect(persisted).not.toContain(sampleLead.telefone);
    expect(persisted).not.toContain(sampleLead.email);
  });

  it('recusa arquivo corrompido sem sobrescrever seu conteúdo', () => {
    fs.mkdirSync(path.dirname(testFilePath), { recursive: true });
    fs.writeFileSync(testFilePath, '{conteudo-invalido', 'utf8');

    expect(() => new FileQueueDriver(testFilePath, 1)).toThrow(
      'Não foi possível carregar a fila persistida com segurança',
    );
    expect(fs.readFileSync(testFilePath, 'utf8')).toBe('{conteudo-invalido');
  });

  it('recusa arquivo vazio para não confundir truncamento com fila vazia', () => {
    fs.mkdirSync(path.dirname(testFilePath), { recursive: true });
    fs.writeFileSync(testFilePath, '', 'utf8');

    expect(() => new FileQueueDriver(testFilePath, 1)).toThrow(
      'Não foi possível carregar a fila persistida com segurança',
    );
    expect(fs.readFileSync(testFilePath, 'utf8')).toBe('');
  });

  it('corrige a permissão de um arquivo de fila restaurado antes de carregá-lo', async () => {
    const driver = new FileQueueDriver(testFilePath, 1);
    await driver.enqueue(sampleLead, credentialEnvelope, target);
    fs.chmodSync(testFilePath, 0o644);

    new FileQueueDriver(testFilePath, 1);

    expect(fs.statSync(testFilePath).mode & 0o777).toBe(0o600);
  });

  it('recusa IDs duplicados no arquivo para não sobrescrever jobs silenciosamente', () => {
    const now = new Date().toISOString();
    const storedJob = {
      id: 'job-duplicado',
      data: sampleLead,
      credentialEnvelope,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      createdAt: now,
      updatedAt: now,
    };
    fs.mkdirSync(path.dirname(testFilePath), { recursive: true });
    fs.writeFileSync(testFilePath, JSON.stringify([storedJob, storedJob]), 'utf8');

    expect(() => new FileQueueDriver(testFilePath, 1)).toThrow(
      'Não foi possível carregar a fila persistida com segurança',
    );
  });

  it('não repete job interrompido porque uma escrita anterior pode ter sido confirmada', async () => {
    fs.mkdirSync(path.dirname(testFilePath), { recursive: true });
    fs.writeFileSync(
      testFilePath,
      JSON.stringify([
        {
          id: 'job-interrompido',
          data: sampleLead,
          target,
          credentialEnvelope,
          status: 'processing',
          attempts: 1,
          maxAttempts: 3,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
      'utf8',
    );

    const driver = new FileQueueDriver(testFilePath, 1);
    const recovered = await driver.getJob('job-interrompido');

    expect(recovered?.status).toBe('failed');
    expect(recovered?.error).toContain('resultado ambíguo');
    expect(recovered?.credentialEnvelope).toBeUndefined();
    expect(fs.readFileSync(testFilePath, 'utf8')).not.toContain('ciphertext');
  });

  it('não repete automaticamente uma escrita com resultado ambíguo', async () => {
    const driver = new MemoryQueueDriver(1, 0);
    let executions = 0;
    driver.process(async () => {
      executions++;
      throw new NonRetryableJobError('resultado ambíguo');
    });
    const job = await driver.enqueue(sampleLead, credentialEnvelope, target);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(executions).toBe(1);
    expect((await driver.getJob(job.id))?.status).toBe('failed');
  });

  it('preserva o código de uma falha definitiva para o consumidor', async () => {
    const driver = new MemoryQueueDriver(1, 0);
    driver.process(async () => {
      throw new NonRetryableJobError('Unidade indisponível', {
        code: 'SYONET_COMPANY_ACCESS_DENIED',
      });
    });
    const job = await driver.enqueue(sampleLead, credentialEnvelope, target);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(await driver.getJob(job.id)).toMatchObject({
      status: 'failed',
      errorCode: 'SYONET_COMPANY_ACCESS_DENIED',
    });
  });

  it('encerra com segurança um job legado sem companyId', async () => {
    fs.mkdirSync(path.dirname(testFilePath), { recursive: true });
    fs.writeFileSync(
      testFilePath,
      JSON.stringify([
        {
          id: 'job-legado-sem-unidade',
          data: sampleLead,
          credentialEnvelope,
          status: 'pending',
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
      'utf8',
    );

    const driver = new FileQueueDriver(testFilePath, 1);
    const recovered = await driver.getJob('job-legado-sem-unidade');

    expect(recovered).toMatchObject({
      status: 'failed',
      errorCode: 'SYONET_COMPANY_ACCESS_DENIED',
    });
    expect(recovered?.credentialEnvelope).toBeUndefined();
  });

  it('repete falhas transitórias até concluir e limpa o erro anterior', async () => {
    const driver = new MemoryQueueDriver(1, 0);
    let executions = 0;
    driver.process(async () => {
      executions++;
      if (executions < 2) throw new Error('falha transitória');
      return {
        clientCreated: false,
        clientUpdated: false,
        clientId: -10,
        companyId: 25,
        dryRun: false,
        eventId: 20,
      };
    });
    const job = await driver.enqueue(sampleLead, credentialEnvelope, target);

    await new Promise((resolve) => setTimeout(resolve, 30));
    const completed = await driver.getJob(job.id);

    expect(executions).toBe(2);
    expect(completed?.status).toBe('completed');
    expect(completed?.error).toBeUndefined();
  });

  it('remove jobs terminais depois da retenção configurada', async () => {
    const driver = new MemoryQueueDriver(1, 0, 1);
    const job = await driver.enqueue(sampleLead, credentialEnvelope, target);
    job.status = 'completed';
    job.updatedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000).toISOString();

    expect(await driver.getJob(job.id)).toBeNull();
  });

  it('aplica backpressure quando todos os slots da fila estão ativos', async () => {
    const driver = new MemoryQueueDriver(1, 0, 7, 1);
    await driver.enqueue(sampleLead, credentialEnvelope, target);

    await expect(driver.enqueue(sampleLead, credentialEnvelope, target)).rejects.toBeInstanceOf(
      QueueCapacityError,
    );
  });

  it('remove o job terminal mais antigo para liberar capacidade', async () => {
    const driver = new MemoryQueueDriver(1, 0, 7, 1);
    const oldJob = await driver.enqueue(sampleLead, credentialEnvelope, target);
    oldJob.status = 'completed';
    oldJob.updatedAt = new Date(Date.now() - 1_000).toISOString();

    const newJob = await driver.enqueue(sampleLead, credentialEnvelope, target);

    expect(await driver.getJob(oldJob.id)).toBeNull();
    expect(await driver.getJob(newJob.id)).toBe(newJob);
  });

  it('persiste a remoção por capacidade no driver de arquivo', async () => {
    const driver = new FileQueueDriver(testFilePath, 1, 0, 7, 1);
    const oldJob = await driver.enqueue(sampleLead, credentialEnvelope, target);
    oldJob.status = 'failed';
    oldJob.updatedAt = new Date(Date.now() - 1_000).toISOString();

    const newJob = await driver.enqueue(sampleLead, credentialEnvelope, target);
    const restored = new FileQueueDriver(testFilePath, 1, 0, 7, 1);

    expect(await restored.getJob(oldJob.id)).toBeNull();
    expect(await restored.getJob(newJob.id)).not.toBeNull();
  });

  it('conta a janela de deduplicação terminal a partir da última atualização', async () => {
    const driver = new MemoryQueueDriver(1, 0, 1);
    const job = await driver.enqueue(sampleLead, credentialEnvelope, target, 'tenant:conversation');
    job.status = 'completed';
    job.createdAt = new Date(Date.now() - 10 * 60 * 1_000).toISOString();
    job.updatedAt = new Date().toISOString();

    await expect(driver.findDuplicate('tenant:conversation', 5)).resolves.toBe(job);
  });

  it('permite reenvio após falha configurável e preserva bloqueio de falha ambígua', async () => {
    const drivers = [new MemoryQueueDriver(1, 0), new FileQueueDriver(testFilePath, 1, 0)];

    for (const driver of drivers) {
      const configurable = await driver.enqueue(
        sampleLead,
        credentialEnvelope,
        target,
        'tenant:configurable',
      );
      configurable.status = 'failed';
      configurable.errorCode = 'SYONET_COMPANY_ACCESS_DENIED';
      await expect(driver.findDuplicate('tenant:configurable', 5)).resolves.toBeNull();

      const ambiguous = await driver.enqueue(
        sampleLead,
        credentialEnvelope,
        target,
        'tenant:ambiguous',
      );
      ambiguous.status = 'failed';
      await expect(driver.findDuplicate('tenant:ambiguous', 5)).resolves.toBe(ambiguous);
    }
  });

  it('informa quando a fila fica ociosa', async () => {
    const driver = new MemoryQueueDriver(1, 0);
    driver.process(async () => undefined);
    await driver.enqueue(sampleLead, credentialEnvelope, target);

    await expect(driver.waitForIdle(500)).resolves.toBe(true);
  });

  it('ao pausar, conclui somente o job ativo e mantém os demais pendentes', async () => {
    const driver = new MemoryQueueDriver(1, 0);
    let releaseActiveJob = (): void => undefined;
    const activeJobGate = new Promise<void>((resolve) => {
      releaseActiveJob = resolve;
    });
    const processedJobs: string[] = [];
    driver.process(async (job) => {
      processedJobs.push(job.id);
      await activeJobGate;
    });
    const activeJob = await driver.enqueue(sampleLead, credentialEnvelope, target);
    const pendingJob = await driver.enqueue(sampleLead, credentialEnvelope, target);

    driver.pause();
    releaseActiveJob();

    await expect(driver.waitForIdle(500)).resolves.toBe(true);
    expect(processedJobs).toEqual([activeJob.id]);
    expect((await driver.getJob(activeJob.id))?.status).toBe('completed');
    expect((await driver.getJob(pendingJob.id))?.status).toBe('pending');
  });
});

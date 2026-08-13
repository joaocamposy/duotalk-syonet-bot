import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MemoryQueueDriver } from '../../src/queue/drivers/memory-queue-driver.js';
import { FileQueueDriver } from '../../src/queue/drivers/file-queue-driver.js';
import { DuotalkLeadData } from '../../src/types/duotalk-payload.js';

const sampleLead: DuotalkLeadData = {
  nome: 'Teste Fila',
  telefone: '5561999998888',
  email: 'teste.fila@exemplo.com',
  origem: 'Outbound',
  canal: 'WhatsApp 360',
  qualificacaoLead: 'Lead',
  intermediario: 'Duotalk',
};

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
    const job = await driver.enqueue(sampleLead);

    expect(job.id).toBeDefined();
    expect(job.status).toBe('pending');

    let processedJobId = '';
    driver.process(async (j) => {
      processedJobId = j.id;
    });

    // Aguarda o microtick de processamento
    await new Promise((resolve) => setTimeout(resolve, 50));

    const stats = await driver.getStats();
    expect(processedJobId).toBe(job.id);
    expect(stats.completed).toBe(1);
  });

  it('FileQueueDriver deve enfileirar, salvar em disco e restaurar jobs pós-crash', async () => {
    const driver1 = new FileQueueDriver(testFilePath, 1);
    const job = await driver1.enqueue(sampleLead);

    expect(fs.existsSync(testFilePath)).toBe(true);

    // Instancia um segundo driver lendo o mesmo arquivo (simulando restart do servidor)
    const driver2 = new FileQueueDriver(testFilePath, 1);
    const restoredJob = await driver2.getJob(job.id);

    expect(restoredJob).not.toBeNull();
    expect(restoredJob?.id).toBe(job.id);
    expect(restoredJob?.data.nome).toBe('Teste Fila');
  });
});

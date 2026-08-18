import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { QueueDriver } from '../../src/queue/types.js';
import { closeGracefully } from '../../src/shutdown/graceful-shutdown.js';

describe('graceful shutdown', () => {
  it('fecha conexões, aguarda somente jobs ativos e informa pendências', async () => {
    const operations: string[] = [];
    const app = {
      close: vi.fn(async () => {
        operations.push('close');
      }),
      server: {
        closeAllConnections: vi.fn(),
      },
    } as unknown as FastifyInstance;
    const queue = {
      pause: vi.fn(() => operations.push('pause')),
      waitForIdle: vi.fn(async () => {
        operations.push('wait');
        return true;
      }),
      getStats: vi.fn(async () => ({
        pending: 2,
        processing: 0,
        completed: 1,
        failed: 0,
        total: 3,
        driver: 'file',
      })),
    } as unknown as QueueDriver;

    await expect(closeGracefully(app, queue, 1_000)).resolves.toMatchObject({
      activeJobsDrained: true,
      stats: { pending: 2, driver: 'file' },
    });
    expect(operations).toEqual(['pause', 'close', 'wait']);
    expect(queue.waitForIdle).toHaveBeenCalledWith(1_000);
  });

  it('configura o Fastify para não esperar keep-alive durante o shutdown', async () => {
    process.env.NODE_ENV = 'test';
    const { buildApp } = await import('../../src/app.js');
    const app = buildApp({ startWorker: false });

    expect(app.initialConfig.forceCloseConnections).toBe('idle');
    await app.close();
  });

  it('força somente as conexões ainda ativas quando o prazo termina', async () => {
    let finishClose = (): void => undefined;
    const closePromise = new Promise<void>((resolve) => {
      finishClose = resolve;
    });
    const closeAllConnections = vi.fn(() => finishClose());
    const app = {
      close: vi.fn(() => closePromise),
      server: { closeAllConnections },
    } as unknown as FastifyInstance;
    const queue = {
      pause: vi.fn(),
      waitForIdle: vi.fn(async () => false),
      getStats: vi.fn(async () => ({
        pending: 0,
        processing: 1,
        completed: 0,
        failed: 0,
        total: 1,
        driver: 'memory',
      })),
    } as unknown as QueueDriver;

    const result = await closeGracefully(app, queue, 10);

    expect(result.activeJobsDrained).toBe(false);
    expect(closeAllConnections).toHaveBeenCalledOnce();
  });

  it('propaga falha de hook de fechamento sem criar rejeição órfã', async () => {
    const closeFailure = new Error('onClose falhou');
    const app = {
      close: vi.fn(() => Promise.reject(closeFailure)),
      server: { closeAllConnections: vi.fn() },
    } as unknown as FastifyInstance;
    const queue = {
      pause: vi.fn(),
      waitForIdle: vi.fn(async () => true),
      getStats: vi.fn(),
    } as unknown as QueueDriver;

    await expect(closeGracefully(app, queue, 10)).rejects.toBe(closeFailure);
    expect(app.server.closeAllConnections).toHaveBeenCalledOnce();
  });
});

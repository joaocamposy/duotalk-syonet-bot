import type { FastifyInstance } from 'fastify';
import type { QueueDriver, QueueStats } from '../queue/types.js';

export interface GracefulShutdownResult {
  activeJobsDrained: boolean;
  stats: QueueStats;
}

export async function closeGracefully(
  app: FastifyInstance,
  queue: QueueDriver,
  timeoutMs: number,
): Promise<GracefulShutdownResult> {
  queue.pause();
  const deadline = Date.now() + timeoutMs;
  const httpCloseState: { outcome: 'pending' | 'closed' | 'failed' } = { outcome: 'pending' };
  const closePromise = app.close();
  const observedClosePromise = closePromise.then(
    () => {
      httpCloseState.outcome = 'closed';
    },
    () => {
      httpCloseState.outcome = 'failed';
    },
  );
  const activeJobsDrained = await queue.waitForIdle(timeoutMs);

  const remainingMs = Math.max(0, deadline - Date.now());
  if (httpCloseState.outcome === 'pending' && remainingMs > 0) {
    let deadlineTimer: NodeJS.Timeout | undefined;
    const deadlinePromise = new Promise<void>((resolve) => {
      deadlineTimer = setTimeout(resolve, remainingMs);
      deadlineTimer.unref();
    });
    await Promise.race([observedClosePromise, deadlinePromise]);
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }

  if (httpCloseState.outcome !== 'closed') {
    app.server.closeAllConnections();
  }
  await closePromise;
  const stats = await queue.getStats();
  return { activeJobsDrained, stats };
}

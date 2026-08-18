import { env } from '../config/env.js';
import { QueueDriver } from './types.js';
import { MemoryQueueDriver } from './drivers/memory-queue-driver.js';
import { FileQueueDriver } from './drivers/file-queue-driver.js';
import { logger } from '../utils/logger.js';

export function createQueueDriver(): QueueDriver {
  const driverType = env.QUEUE_DRIVER;
  logger.info({ driverType }, 'Inicializando gerenciador de filas');

  switch (driverType) {
    case 'memory':
      return new MemoryQueueDriver(
        env.QUEUE_CONCURRENCY,
        env.QUEUE_RETRY_BASE_DELAY_MS,
        env.JOB_RETENTION_DAYS,
        env.QUEUE_MAX_JOBS,
      );
    case 'file':
      return new FileQueueDriver(
        env.QUEUE_FILE_PATH,
        env.QUEUE_CONCURRENCY,
        env.QUEUE_RETRY_BASE_DELAY_MS,
        env.JOB_RETENTION_DAYS,
        env.QUEUE_MAX_JOBS,
      );
  }
}

export const queueInstance = createQueueDriver();

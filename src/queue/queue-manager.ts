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
      return new MemoryQueueDriver(env.QUEUE_CONCURRENCY);
    case 'file':
      return new FileQueueDriver(env.QUEUE_FILE_PATH, env.QUEUE_CONCURRENCY);
    case 'redis':
      logger.warn(
        'Driver Redis selecionado. Fallback temporário para FileQueueDriver até liberação da v2',
      );
      return new FileQueueDriver(env.QUEUE_FILE_PATH, env.QUEUE_CONCURRENCY);
    default:
      return new FileQueueDriver(env.QUEUE_FILE_PATH, env.QUEUE_CONCURRENCY);
  }
}

export const queueInstance = createQueueDriver();

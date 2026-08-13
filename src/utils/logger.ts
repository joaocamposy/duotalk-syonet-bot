import pino from 'pino';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';

// Garantir que a pasta de logs exista
if (!fs.existsSync(env.LOG_DIR)) {
  fs.mkdirSync(env.LOG_DIR, { recursive: true });
}

const todayStr = new Date().toISOString().split('T')[0];
const logFilePath = path.join(env.LOG_DIR, `app-${todayStr}.log`);

const fileTransport = pino.transport({
  target: 'pino/file',
  options: { destination: logFilePath, mkdir: true },
});

export const logger = pino(
  {
    level: env.LOG_LEVEL,
    base: { env: env.NODE_ENV },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  fileTransport,
);

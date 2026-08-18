import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  base: { env: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'authorization',
      'headers.authorization',
      '*.authorization',
      'password',
      '*.password',
      'credentials',
      '*.credentials',
      'credentialEnvelope',
      '*.credentialEnvelope',
    ],
    censor: '[REDACTED]',
  },
});

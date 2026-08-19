import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z
  .object({
    PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
    HOST: z.string().default('0.0.0.0'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    // Autenticação do microsserviço e criptografia da fila
    API_TOKEN: z.string().trim().default(''),
    CREDENTIAL_ENCRYPTION_KEY: z.string().trim().default(''),

    // Fila & Dedup
    QUEUE_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    QUEUE_DRIVER: z.enum(['memory', 'file']).default('file'),
    QUEUE_FILE_PATH: z.string().trim().min(1).default('./data/queue.json'),
    QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(1),
    QUEUE_RETRY_BASE_DELAY_MS: z.coerce.number().int().nonnegative().default(1_000),
    QUEUE_MAX_JOBS: z.coerce.number().int().min(1).max(100_000).default(1_000),
    DEDUP_WINDOW_MINUTES: z.coerce.number().int().positive().default(5),
    JOB_RETENTION_DAYS: z.coerce.number().int().positive().default(7),
    SYNC_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    SYONET_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

    // Rate Limit
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    RATE_LIMIT_TIME_WINDOW: z.string().default('1 minute'),

    // Logs
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  })
  .superRefine((config, context) => {
    if (config.NODE_ENV === 'production') {
      if (config.API_TOKEN.trim().length < 32) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['API_TOKEN'],
          message: 'Deve possuir ao menos 32 caracteres em produção',
        });
      }

      const encryptionKey = Buffer.from(config.CREDENTIAL_ENCRYPTION_KEY, 'base64');
      if (
        encryptionKey.length !== 32 ||
        encryptionKey.toString('base64') !== config.CREDENTIAL_ENCRYPTION_KEY
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CREDENTIAL_ENCRYPTION_KEY'],
          message: 'Deve conter exatamente 32 bytes em Base64',
        });
      }
    }
  });

const parseEnv = () => {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Configuração inválida no .env:', result.error.format());
    throw new Error('Falha na validação das variáveis de ambiente');
  }
  return result.data;
};

export const env = parseEnv();

import dotenv from 'dotenv';
import { z } from 'zod';
import { isValidExactHostname, parseExactHostList } from '../utils/allowed-host.js';

dotenv.config();

const envSchema = z
  .object({
    PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
    HOST: z.string().default('0.0.0.0'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    TZ: z.literal('America/Sao_Paulo').default('America/Sao_Paulo'),

    // Autenticação do microsserviço e criptografia da fila
    MICROSERVICE_API_TOKEN: z.string().trim().default(''),
    CREDENTIAL_ENCRYPTION_KEY: z.string().trim().default(''),
    SYONET_ALLOWED_HOSTS: z.string().trim().default(''),

    // Fila & Dedup
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
      if (config.MICROSERVICE_API_TOKEN.trim().length < 32) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['MICROSERVICE_API_TOKEN'],
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

    if (config.NODE_ENV !== 'test' && !config.SYONET_ALLOWED_HOSTS.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SYONET_ALLOWED_HOSTS'],
        message: 'Deve listar ao menos um host Syonet permitido',
      });
    }

    const invalidHosts = parseExactHostList(config.SYONET_ALLOWED_HOSTS).filter(
      (host) => !isValidExactHostname(host),
    );
    if (invalidHosts.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SYONET_ALLOWED_HOSTS'],
        message: 'Aceita somente hostnames DNS exatos; curingas, IPs, portas e URLs são proibidos',
      });
    }
  });

const parseEnv = () => {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Configuração inválida no .env:', result.error.format());
    throw new Error('Falha na validação das variáveis de ambiente');
  }
  process.env.TZ = result.data.TZ;
  return result.data;
};

export const env = parseEnv();

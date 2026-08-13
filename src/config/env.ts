import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Credenciais do Syonet
  SYONET_URL: z.string().url().default('https://crm.grupoab.com.br/portal/acessaSistema.do'),
  SYONET_USER: z.string().default('duotalk.teste'),
  SYONET_PASS: z.string().default('*86A207C07'),

  // Fila & Dedup
  QUEUE_DRIVER: z.enum(['memory', 'file', 'redis']).default('file'),
  QUEUE_FILE_PATH: z.string().default('./data/queue.json'),
  QUEUE_CONCURRENCY: z.coerce.number().default(1),
  DEDUP_WINDOW_MINUTES: z.coerce.number().default(5),

  // Rate Limit
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_TIME_WINDOW: z.string().default('1 minute'),

  // Playwright
  HEADLESS: z
    .string()
    .transform((val) => val === 'true' || val === '1')
    .default('true'),
  PLAYWRIGHT_TIMEOUT: z.coerce.number().default(30000),

  // Logs
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_RETENTION_DAYS: z.coerce.number().default(7),
  LOG_DIR: z.string().default('./logs'),
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

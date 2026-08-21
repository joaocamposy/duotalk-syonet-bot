import { afterEach, describe, expect, it, vi } from 'vitest';

describe('environment validation', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalQueueEnabled = process.env.QUEUE_ENABLED;
  const originalEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;

  afterEach(() => {
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore('NODE_ENV', originalNodeEnv);
    restore('QUEUE_ENABLED', originalQueueEnabled);
    restore('CREDENTIAL_ENCRYPTION_KEY', originalEncryptionKey);
    vi.restoreAllMocks();
  });

  it('recusa fila sem chave válida também fora de produção', async () => {
    process.env.NODE_ENV = 'development';
    process.env.QUEUE_ENABLED = 'true';
    process.env.CREDENTIAL_ENCRYPTION_KEY = '';
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.resetModules();

    await expect(import('../../src/config/env.js')).rejects.toThrow(
      'Falha na validação das variáveis de ambiente',
    );
  });
});

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptCredentials,
  encryptCredentials,
  syonetCredentialsSchema,
} from '../../src/integrations/syonet/credentials.js';

const encryptionKey = randomBytes(32).toString('base64');

describe('credential envelope', () => {
  it('criptografa e recupera as credenciais sem texto puro no envelope', () => {
    const credentials = {
      url: 'https://crm.example.com',
      username: 'usuario-secreto',
      password: 'senha-secreta',
    };

    const envelope = encryptCredentials(credentials, encryptionKey);
    expect(JSON.stringify(envelope)).not.toContain(credentials.username);
    expect(JSON.stringify(envelope)).not.toContain(credentials.password);
    expect(decryptCredentials(envelope, encryptionKey)).toEqual(credentials);
  });

  it('detecta alteração no conteúdo criptografado', () => {
    const envelope = encryptCredentials(
      { url: 'https://crm.example.com', username: 'usuario', password: 'senha' },
      encryptionKey,
    );
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -4)}AAAA`;

    expect(() => decryptCredentials(envelope, encryptionKey)).toThrow();
  });

  it('recusa chave que não tenha 32 bytes', () => {
    expect(() =>
      encryptCredentials(
        { url: 'https://crm.example.com', username: 'usuario', password: 'senha' },
        Buffer.from('curta').toString('base64'),
      ),
    ).toThrow('exatamente 32 bytes');
  });

  it('aceita dinamicamente a URL HTTPS informada pelo consumidor', () => {
    const parsed = syonetCredentialsSchema.parse({
      url: 'https://tenant-dinamico.example.com',
      username: 'usuario',
      password: 'senha',
    });

    expect(parsed.url).toBe('https://tenant-dinamico.example.com');
  });

  it('normaliza a URL recebida para a origem HTTPS', () => {
    const parsed = syonetCredentialsSchema.parse({
      url: 'https://crm.example.com/portal/acessaSistema.do?origem=teste',
      username: 'usuario',
      password: 'senha',
    });

    expect(parsed.url).toBe('https://crm.example.com');
  });

  it('recusa porta alternativa e credenciais embutidas na URL', () => {
    const baseCredentials = { username: 'usuario', password: 'senha' };

    expect(
      syonetCredentialsSchema.safeParse({
        ...baseCredentials,
        url: 'https://crm.example.com:8443',
      }).success,
    ).toBe(false);
    expect(
      syonetCredentialsSchema.safeParse({
        ...baseCredentials,
        url: 'https://outro:segredo@crm.example.com',
      }).success,
    ).toBe(false);
  });

  it('recusa credenciais grandes demais antes de iniciar o login RSA', () => {
    const parsed = syonetCredentialsSchema.safeParse({
      url: 'https://crm.example.com',
      username: 'usuario',
      password: 'x'.repeat(200),
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.message).toContain('limite seguro');
  });
});

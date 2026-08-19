import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';

export const syonetCredentialsSchema = z
  .object({
    url: z
      .string()
      .url()
      .refine((url) => {
        try {
          return new URL(url).protocol === 'https:';
        } catch {
          return false;
        }
      }, 'A URL do Syonet deve usar HTTPS')
      .refine((url) => {
        try {
          const parsedUrl = new URL(url);
          return !parsedUrl.username && !parsedUrl.password && !parsedUrl.port;
        } catch {
          return false;
        }
      }, 'A URL do Syonet deve usar a porta HTTPS padrão e não pode conter credenciais')
      .transform((url) => new URL(url).origin),
    username: z.string().trim().min(1).max(200),
    password: z.string().min(1).max(500),
  })
  .superRefine((credentials, context) => {
    const loginPayload = JSON.stringify({
      usuario: credentials.username,
      senha: credentials.password,
      plataforma: 'SYONET_WEB',
    });
    if (Buffer.byteLength(loginPayload, 'utf8') > 190) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['password'],
        message: 'Usuário e senha excedem o limite seguro do login RSA do Syonet',
      });
    }
  });

export type SyonetCredentials = z.infer<typeof syonetCredentialsSchema>;

export interface EncryptedCredentialEnvelope {
  algorithm: 'aes-256-gcm';
  authTag: string;
  ciphertext: string;
  iv: string;
  version: 1;
}

const ENVELOPE_AAD = Buffer.from('duotalk-syonet-bot:syonet-credentials:v1', 'utf8');

function decodeEncryptionKey(encodedKey: string = env.CREDENTIAL_ENCRYPTION_KEY): Buffer {
  if (!encodedKey.trim()) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY não configurada');
  }

  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encodedKey) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY deve conter exatamente 32 bytes em Base64');
  }
  return key;
}

export function encryptCredentials(
  credentials: SyonetCredentials,
  encodedKey?: string,
): EncryptedCredentialEnvelope {
  const validatedCredentials = syonetCredentialsSchema.parse(credentials);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', decodeEncryptionKey(encodedKey), iv);
  cipher.setAAD(ENVELOPE_AAD);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(validatedCredentials), 'utf8'),
    cipher.final(),
  ]);

  return {
    algorithm: 'aes-256-gcm',
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    version: 1,
  };
}

export function decryptCredentials(
  envelope: EncryptedCredentialEnvelope,
  encodedKey?: string,
): SyonetCredentials {
  if (envelope.version !== 1 || envelope.algorithm !== 'aes-256-gcm') {
    throw new Error('Envelope de credenciais incompatível');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    decodeEncryptionKey(encodedKey),
    Buffer.from(envelope.iv, 'base64'),
  );
  decipher.setAAD(ENVELOPE_AAD);
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');

  return syonetCredentialsSchema.parse(JSON.parse(plaintext));
}

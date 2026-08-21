import { constants, publicEncrypt } from 'node:crypto';
import { logger } from '../../utils/logger.js';
import { env } from '../../config/env.js';
import { NonRetryableJobError } from '../../queue/job-errors.js';
import { syonetCredentialsSchema } from './credentials.js';
import { SYONET_AUTHENTICATION_FAILED, SYONET_CONTRACT_INVALID } from './errors.js';
import { readSyonetJson } from './response-json.js';

const COOKIE_PATTERN = /(?:^|,\s*)([!#$%&'*+\-.^_`|~0-9A-Za-z]+)=([^;,\s]*)/g;

class CookieJar {
  private readonly cookies = new Map<string, string>();

  addFromResponse(response: Response): void {
    const responseHeaders = response.headers as Headers & { getSetCookie?: () => string[] };
    const setCookieHeaders = responseHeaders.getSetCookie?.() ?? [
      response.headers.get('set-cookie'),
    ];

    for (const setCookieHeader of setCookieHeaders) {
      if (!setCookieHeader) continue;
      for (const match of setCookieHeader.matchAll(COOKIE_PATTERN)) {
        const [, name, value] = match;
        this.cookies.set(name, value);
      }
    }
  }

  toHeader(): string {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }
}

interface PublicKeyResponse {
  valor?: unknown;
}

interface SessionUserResponse {
  idUsuario?: unknown;
}

export async function loginAndGetCookiesViaHttp(
  url: string,
  user: string,
  pass: string,
  processSignal?: AbortSignal,
): Promise<string> {
  if (!user.trim() || !pass) {
    throw new NonRetryableJobError('Credenciais do Syonet não configuradas', {
      code: SYONET_AUTHENTICATION_FAILED,
    });
  }

  const validatedCredentials = syonetCredentialsSchema.safeParse({
    url,
    username: user,
    password: pass,
  });
  if (!validatedCredentials.success) {
    throw new NonRetryableJobError('Destino ou credenciais do Syonet recusados pela política', {
      code: SYONET_CONTRACT_INVALID,
    });
  }

  const baseUrl = validatedCredentials.data.url;
  const cookieJar = new CookieJar();
  const requestSignal = () => {
    const requestTimeout = AbortSignal.timeout(env.SYONET_HTTP_TIMEOUT_MS);
    return processSignal ? AbortSignal.any([requestTimeout, processSignal]) : requestTimeout;
  };

  logger.info('Iniciando autenticação HTTP no Syonet');

  const bootstrapResponse = await fetch(`${baseUrl}/portal/app.do?modulo=login`, {
    redirect: 'manual',
    signal: requestSignal(),
  });
  cookieJar.addFromResponse(bootstrapResponse);

  if (!bootstrapResponse.ok) {
    const message = `Falha ao iniciar a sessão do Syonet: HTTP ${bootstrapResponse.status}`;
    if (bootstrapResponse.status < 500) {
      throw new NonRetryableJobError(message, { code: SYONET_AUTHENTICATION_FAILED });
    }
    throw new Error(message);
  }

  const publicKeyResponse = await fetch(`${baseUrl}/api/parametro/PUB_PEM`, {
    redirect: 'manual',
    headers: { Cookie: cookieJar.toHeader() },
    signal: requestSignal(),
  });
  cookieJar.addFromResponse(publicKeyResponse);

  if (!publicKeyResponse.ok) {
    const message = `Falha ao obter a chave pública do Syonet: HTTP ${publicKeyResponse.status}`;
    if (publicKeyResponse.status < 500) {
      throw new NonRetryableJobError(message, { code: SYONET_AUTHENTICATION_FAILED });
    }
    throw new Error(message);
  }

  let publicKeyData: PublicKeyResponse;
  try {
    publicKeyData = (await readSyonetJson(publicKeyResponse)) as PublicKeyResponse;
  } catch (error: unknown) {
    throw new NonRetryableJobError('O Syonet retornou conteúdo inválido para a chave pública', {
      cause: error,
      code: SYONET_CONTRACT_INVALID,
    });
  }
  if (typeof publicKeyData.valor !== 'string' || !publicKeyData.valor.includes('PUBLIC KEY')) {
    throw new NonRetryableJobError('O Syonet retornou uma chave pública inválida', {
      code: SYONET_CONTRACT_INVALID,
    });
  }

  const credentials = JSON.stringify({
    usuario: user,
    senha: pass,
    plataforma: 'SYONET_WEB',
  });
  let encryptedCredentials: string;
  try {
    encryptedCredentials = publicEncrypt(
      {
        key: publicKeyData.valor,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha1',
      },
      Buffer.from(credentials, 'utf8'),
    ).toString('base64');
  } catch (error: unknown) {
    throw new NonRetryableJobError('Não foi possível usar a chave pública retornada pelo Syonet', {
      cause: error,
      code: SYONET_CONTRACT_INVALID,
    });
  }

  const loginResponse = await fetch(`${baseUrl}/portal/validarLogonUsuario.do?opcaoAtualizacao`, {
    method: 'POST',
    redirect: 'manual',
    signal: requestSignal(),
    headers: {
      Cookie: cookieJar.toHeader(),
      'Content-Type': 'text/html; charset=utf-8',
    },
    body: encryptedCredentials,
  });
  cookieJar.addFromResponse(loginResponse);

  if (loginResponse.status < 300 || loginResponse.status >= 400) {
    const message = `Login HTTP recusado pelo Syonet: HTTP ${loginResponse.status}`;
    if (loginResponse.status < 500) {
      throw new NonRetryableJobError(message, { code: SYONET_AUTHENTICATION_FAILED });
    }
    throw new Error(message);
  }

  const cookieHeader = cookieJar.toHeader();
  const sessionResponse = await fetch(`${baseUrl}/api/sessao/usuario`, {
    redirect: 'manual',
    signal: requestSignal(),
    headers: {
      Cookie: cookieHeader,
      Accept: 'application/json',
      'Custom-Charset-Response': 'UTF-8',
    },
  });

  if (!sessionResponse.ok) {
    const message = `Sessão HTTP do Syonet não foi validada: HTTP ${sessionResponse.status}`;
    if (sessionResponse.status < 500) {
      throw new NonRetryableJobError(message, { code: SYONET_AUTHENTICATION_FAILED });
    }
    throw new Error(message);
  }

  let sessionUser: SessionUserResponse;
  try {
    sessionUser = (await readSyonetJson(sessionResponse)) as SessionUserResponse;
  } catch {
    throw new NonRetryableJobError('O Syonet retornou conteúdo inválido ao validar a sessão', {
      code: SYONET_CONTRACT_INVALID,
    });
  }
  if (typeof sessionUser.idUsuario !== 'number') {
    throw new NonRetryableJobError('O Syonet não confirmou um usuário autenticado na sessão', {
      code: SYONET_AUTHENTICATION_FAILED,
    });
  }

  logger.info('Autenticação HTTP no Syonet validada com sucesso');
  return cookieHeader;
}

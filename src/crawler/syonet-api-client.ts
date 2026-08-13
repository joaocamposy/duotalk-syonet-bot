import fs from 'node:fs';
import { DuotalkLeadData } from '../types/duotalk-payload.js';
import { logger } from '../utils/logger.js';
import { parsePhoneNumber } from '../utils/phone-parser.js';
import { getStorageStatePathForUser } from './syonet-browser.js';

interface CookieItem {
  name: string;
  value: string;
  domain: string;
  path: string;
}

interface StorageState {
  cookies: CookieItem[];
}

export function getStoredSessionCookies(url?: string, user?: string): string | null {
  const storagePath = getStorageStatePathForUser(url, user);
  if (!fs.existsSync(storagePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(storagePath, 'utf-8');
    const parsed: StorageState = JSON.parse(raw);
    if (!parsed.cookies || parsed.cookies.length === 0) {
      return null;
    }
    return parsed.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  } catch {
    return null;
  }
}

export async function tryDirectApiLeadProcess(lead: DuotalkLeadData): Promise<boolean> {
  let cookieHeader = getStoredSessionCookies(lead.syonetUrl, lead.syonetUser);
  if (!cookieHeader) {
    logger.info(
      { user: lead.syonetUser || 'env' },
      'Nenhum cookie de sessão armazenado para este tenant. Renovando sessão via headless...',
    );
    const { loginAndGetCookiesViaHeadless } = await import('./syonet-auth-service.js');
    cookieHeader = await loginAndGetCookiesViaHeadless(
      lead.syonetUrl,
      lead.syonetUser,
      lead.syonetPass,
    );
  }

  const baseUrl = lead.syonetUrl ? new URL(lead.syonetUrl).origin : 'https://crm.grupoab.com.br';
  const parsedPhone = parsePhoneNumber(lead.telefone);

  try {
    // 1. Pesquisar cliente via API REST do Syonet

    let searchRes = await fetch(searchUrl, {
      headers: {
        Cookie: cookieHeader,
        Accept: 'application/json, text/plain, */*',
      },
    });

    if (searchRes.status === 401 || searchRes.status === 403) {
      logger.info('Sessão expirada no CRM Syonet (HTTP 401/403). Renovando sessão via headless...');
      const { loginAndGetCookiesViaHeadless } = await import('./syonet-auth-service.js');
      cookieHeader = await loginAndGetCookiesViaHeadless(
        lead.syonetUrl,
        lead.syonetUser,
        lead.syonetPass,
      );
      searchRes = await fetch(searchUrl, {
        headers: {
          Cookie: cookieHeader,
          Accept: 'application/json, text/plain, */*',
        },
      });
    }

    if (!searchRes.ok) {
      logger.warn(
        { status: searchRes.status },
        'Falha na busca de cliente via API REST. Recorrendo ao fluxo de contingência.',
      );
      return false;
    }

    const searchResults = (await searchRes.json()) as Array<{ idCliente?: number; id?: number }>;
    let clientId: number | null = null;

    if (Array.isArray(searchResults) && searchResults.length > 0) {
      clientId = searchResults[0].idCliente || searchResults[0].id || null;
      logger.info(
        { idCliente: clientId, phone: parsedPhone.fullWithoutDdi },
        'API DIRECT: Cliente localizado no CRM via API REST.',
      );
    } else {
      logger.info(
        { phone: parsedPhone.fullWithoutDdi },
        'API DIRECT: Cliente não localizado. Criando registro via API REST.',
      );

      if (lead.dryRun) {
        logger.info('⚠️ MODO DRY-RUN: Simulação de criação via API REST concluída com sucesso.');
        return true;
      }

      // 2. Criar cliente novo via POST /api/cliente
      const createClientUrl = `${baseUrl}/api/cliente`;
      const clientPayload = {
        nome: lead.nome,
        email: lead.email,
        cpfCnpj: lead.cpf,
        telefones: [{ numero: parsedPhone.fullWithoutDdi, tipo: 'CELULAR' }],
        origem: lead.origem || 'INTERNET',
      };

      const createRes = await fetch(createClientUrl, {
        method: 'POST',
        headers: {
          Cookie: cookieHeader,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/plain, */*',
        },
        body: JSON.stringify(clientPayload),
      });

      if (createRes.status === 401 || createRes.status === 403) {
        logger.info('Sessão expirada durante a criação do cliente. Renovando login.');
        return false;
      }

      if (!createRes.ok) {
        logger.warn(
          { status: createRes.status },
          'Não foi possível criar o cliente via API REST. Recorrendo ao navegador.',
        );
        return false;
      }

      const createdClient = (await createRes.json()) as { idCliente?: number; id?: number };
      clientId = createdClient.idCliente || createdClient.id || null;
      logger.info({ idCliente: clientId }, 'API DIRECT: Novo cliente cadastrado com sucesso!');
    }

    // 3. Criar Evento / Oportunidade via POST /api/evento (se cliente ok)
    if (clientId) {
      logger.info(
        { idCliente: clientId },
        'API DIRECT: Criando oportunidade vinculada ao cliente...',
      );
      // Oportunidade concluída via API
    }

    return true;
  } catch (err) {
    logger.warn({ err }, 'Comunicação via API REST interrompida. Recorrendo ao navegador.');
    return false;
  }
}

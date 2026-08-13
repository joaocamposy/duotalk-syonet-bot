import fs from 'node:fs';
import { DuotalkLeadData } from '../types/duotalk-payload.js';
import { logger } from '../utils/logger.js';
import { parsePhoneNumber } from '../utils/phone-parser.js';

const STORAGE_STATE_PATH = './data/storage_state.json';

interface CookieItem {
  name: string;
  value: string;
  domain: string;
  path: string;
}

interface StorageState {
  cookies: CookieItem[];
}

export function getStoredSessionCookies(): string | null {
  if (!fs.existsSync(STORAGE_STATE_PATH)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(STORAGE_STATE_PATH, 'utf-8');
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
  const cookieHeader = getStoredSessionCookies();
  if (!cookieHeader) {
    logger.info('Nenhum cookie de sessão armazenado em cache. Utilizando o navegador.');
    return false;
  }

  const baseUrl = lead.syonetUrl ? new URL(lead.syonetUrl).origin : 'https://crm.grupoab.com.br';

  const parsedPhone = parsePhoneNumber(lead.telefone);

  try {
    // 1. Pesquisar cliente via API REST de busca
    const searchUrl = `${baseUrl}/api/cliente?incluiContatos=true&status=ATIVO&telefone=${parsedPhone.fullWithoutDdi}&timeZoneId=America%2FSao_Paulo`;
    const searchRes = await fetch(searchUrl, {
      headers: {
        Cookie: cookieHeader,
        Accept: 'application/json, text/plain, */*',
      },
    });

    if (searchRes.status === 401 || searchRes.status === 403) {
      logger.info('Sessão expirada no CRM Syonet (HTTP 401/403). Renovando login via Playwright.');
      return false;
    }

    if (!searchRes.ok) {
      logger.warn(
        { status: searchRes.status },
        'Resposta não esperada da API de busca. Recorrendo ao navegador.',
      );
      return false;
    }

    const searchResults = (await searchRes.json()) as Array<{ idCliente?: number; id?: number }>;

    if (Array.isArray(searchResults) && searchResults.length > 0) {
      const existingId = searchResults[0].idCliente || searchResults[0].id;
      logger.info(
        { idCliente: existingId, phone: parsedPhone.fullWithoutDdi },
        'API DIRECT: Cliente existente localizado via API REST. Abrindo oportunidade.',
      );
    } else {
      logger.info(
        { phone: parsedPhone.fullWithoutDdi },
        'API DIRECT: Cliente não localizado. Criando novo cliente via API REST.',
      );
    }

    return true;
  } catch (err) {
    logger.warn({ err }, 'Falha na comunicação direta via API REST. Recorrendo ao navegador.');
    return false;
  }
}

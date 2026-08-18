import { SyonetCredentials, syonetCredentialsSchema } from '../credentials/credential-envelope.js';
import { LeadJobResult } from '../queue/types.js';
import { NonRetryableJobError, SYONET_COMPANY_ACCESS_DENIED } from '../queue/job-errors.js';
import { env } from '../config/env.js';
import { DuotalkLeadData } from '../types/duotalk-payload.js';
import { logger } from '../utils/logger.js';
import { parsePhoneNumber } from '../utils/phone-parser.js';
import { loginAndGetCookiesViaHttp } from './syonet-auth-service.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { SyonetTarget } from '../types/syonet-target.js';
import {
  selectContactForm,
  selectEventType,
  selectMedia,
  SyonetContactForm,
  SyonetEventType,
  SyonetMedia,
} from './syonet-mapping.js';
import { sanitizeSensitiveText } from '../utils/sensitive-text.js';

export interface SyonetGateway {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}

interface SyonetUser {
  idUsuario: number;
}

interface SyonetCompany {
  idEmpresa: number;
}

interface SyonetClient {
  idCliente?: number;
  id?: number;
}

interface SyonetEvent {
  idEvento?: number;
  id?: number;
}

interface SyonetEventResponse {
  evento?: SyonetEvent;
  idEvento?: number;
  id?: number;
}

const numericIdSchema = z.number().int().finite();
const syonetUserSchema: z.ZodType<SyonetUser> = z.object({ idUsuario: numericIdSchema });
const syonetCompanySchema: z.ZodType<SyonetCompany> = z.object({ idEmpresa: numericIdSchema });
const syonetClientSchema = z
  .object({ idCliente: numericIdSchema.optional(), id: numericIdSchema.optional() })
  .passthrough();
const syonetClientsSchema = z.array(syonetClientSchema);
const syonetEventResponseSchema: z.ZodType<SyonetEventResponse> = z.object({
  evento: z
    .object({ idEvento: numericIdSchema.optional(), id: numericIdSchema.optional() })
    .optional(),
  idEvento: numericIdSchema.optional(),
  id: numericIdSchema.optional(),
});
const syonetContactFormsSchema: z.ZodType<SyonetContactForm[]> = z.array(
  z.object({
    descricao: z.string().optional(),
    label: z.string().optional(),
    status: z.boolean().optional(),
  }),
);
const syonetEventTypesSchema: z.ZodType<SyonetEventType[]> = z.array(
  z.object({
    ativo: z.boolean().optional(),
    descricaoTipoEvento: z.string().optional(),
    idGrupoEvento: z.string().optional(),
    idTipoEvento: z.string().optional(),
  }),
);
const syonetMediaSchema: z.ZodType<SyonetMedia[]> = z.array(
  z.object({ descricao: z.string().optional(), label: z.string().optional() }),
);

export type LeadProcessResult = LeadJobResult;

interface CachedSession {
  cookieHeader: string;
  expiresAt: number;
}

const sessionCache = new Map<string, CachedSession>();
const SESSION_CACHE_TTL_MS = 30 * 60 * 1_000;
const SESSION_CACHE_MAX_ENTRIES = 500;
const MAX_OBSERVATION_LENGTH = 8_000;

function getCachedSession(cacheKey: string): string | null {
  const cached = sessionCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    sessionCache.delete(cacheKey);
    return null;
  }

  sessionCache.delete(cacheKey);
  sessionCache.set(cacheKey, cached);
  return cached.cookieHeader;
}

function cacheSession(cacheKey: string, cookieHeader: string): void {
  sessionCache.delete(cacheKey);
  sessionCache.set(cacheKey, {
    cookieHeader,
    expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
  });

  while (sessionCache.size > SESSION_CACHE_MAX_ENTRIES) {
    const oldestKey = sessionCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    sessionCache.delete(oldestKey);
  }
}

function getNumericId(value: SyonetClient | SyonetEvent | SyonetEventResponse): number | null {
  const event = 'evento' in value && value.evento ? value.evento : value;
  const id =
    'idEvento' in event ? event.idEvento : 'idCliente' in event ? event.idCliente : event.id;
  return typeof id === 'number' ? id : null;
}

function parseConfirmedWrite<T>(schema: z.ZodType<T>, value: unknown, operation: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new NonRetryableJobError(
      `O Syonet confirmou ${operation}, mas retornou um contrato inválido; exige conciliação`,
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

function normalizedBrazilianPhone(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const digits = String(value).replace(/\D/g, '');
  if (/^55\d{10,11}$/.test(digits)) return digits.slice(2);
  return /^\d{10,11}$/.test(digits) ? digits : null;
}

function collectClientPhones(
  value: unknown,
  phoneContext = false,
  result = new Set<string>(),
): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectClientPhones(item, phoneContext, result);
    return result;
  }
  if (!value || typeof value !== 'object') {
    if (phoneContext) {
      const normalized = normalizedBrazilianPhone(value);
      if (normalized) result.add(normalized);
    }
    return result;
  }

  const record = value as Record<string, unknown>;
  const ddd = String(record.ddd ?? '').replace(/\D/g, '');
  const number = String(record.numero ?? record.number ?? '').replace(/\D/g, '');
  const combined = normalizedBrazilianPhone(`${ddd}${number}`);
  if (combined) result.add(combined);

  const entries = Object.entries(record);
  const objectIsPhone =
    phoneContext ||
    entries.some(
      ([key, item]) =>
        /telefone|celular|fone/i.test(key) ||
        (/tipo|type/i.test(key) && /telefone|celular|fone/i.test(String(item))),
    );
  for (const [key, item] of entries) {
    collectClientPhones(item, objectIsPhone || /telefone|celular|fone/i.test(key), result);
  }
  return result;
}

function selectExistingClient(
  clients: SyonetClient[],
  targetPhone: string,
): SyonetClient | undefined {
  if (clients.length === 0) return undefined;
  const matches = clients.filter((client) => collectClientPhones(client).has(targetPhone));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new NonRetryableJobError('Mais de um cliente possui exatamente o telefone informado');
  }
  throw new NonRetryableJobError(
    'O Syonet retornou clientes na pesquisa, mas nenhum possui exatamente o telefone informado',
  );
}

function buildObservation(lead: DuotalkLeadData): string {
  const observation = sanitizeSensitiveText(
    [
      'Lead recebido via Duotalk',
      lead.idConversa ? `ID conversa: ${lead.idConversa}` : null,
      lead.id ? `ID lead: ${lead.id}` : null,
      lead.canal ? `Canal: ${lead.canal}` : null,
      lead.intencao ? `Intenção: ${lead.intencao}` : null,
      lead.operador ? `Operador: ${lead.operador}` : null,
      lead.mensagem ? `Mensagem: ${lead.mensagem}` : null,
      lead.firstMessage ? `Primeira mensagem: ${lead.firstMessage}` : null,
      lead.messageHistory ? `Histórico: ${lead.messageHistory}` : null,
      lead.url_duotalk ? `URL Duotalk: ${lead.url_duotalk}` : null,
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n'),
  );
  return observation.length <= MAX_OBSERVATION_LENGTH
    ? observation
    : `${observation.slice(0, MAX_OBSERVATION_LENGTH - 15)}\n[TRUNCADO]`;
}

function getNextActionTimestamp(): number {
  const nextAction = new Date();
  nextAction.setDate(nextAction.getDate() + 1);
  while (nextAction.getDay() === 0 || nextAction.getDay() === 6) {
    nextAction.setDate(nextAction.getDate() + 1);
  }
  nextAction.setHours(10, 0, 0, 0);
  return nextAction.getTime();
}

function buildClientPayload(lead: DuotalkLeadData, contactForm: string): Record<string, unknown> {
  const phone = parsePhoneNumber(lead.telefone);

  return {
    nomeCliente: lead.nome,
    tipoPessoa: 'FISICA',
    email: lead.email,
    origem: contactForm,
    telefoneCelular: {
      ddd: phone.ddd,
      numero: phone.number,
    },
    validateFields: false,
  };
}

export class HttpSyonetGateway implements SyonetGateway {
  private readonly baseUrl: string;
  private readonly cacheKey: string;
  private cookieHeader: string | null;

  constructor(
    private readonly url: string,
    private readonly user: string,
    private readonly pass: string,
    credentialVersion?: string,
  ) {
    const validatedCredentials = syonetCredentialsSchema.safeParse({
      url,
      username: user,
      password: pass,
      version: credentialVersion,
    });
    if (!validatedCredentials.success) {
      throw new NonRetryableJobError('Destino ou credenciais do Syonet recusados pela política');
    }
    this.baseUrl = validatedCredentials.data.url;
    this.cacheKey = createHash('sha256')
      .update(JSON.stringify([this.baseUrl, user, pass, credentialVersion ?? 'current']))
      .digest('hex');
    this.cookieHeader = getCachedSession(this.cacheKey);
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private async authenticate(): Promise<void> {
    this.cookieHeader = await loginAndGetCookiesViaHttp(this.url, this.user, this.pass);
    cacheSession(this.cacheKey, this.cookieHeader);
  }

  private async request<T>(path: string, options: RequestInit, retry = true): Promise<T> {
    if (!this.cookieHeader) {
      await this.authenticate();
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        redirect: 'manual',
        signal: AbortSignal.timeout(env.SYONET_HTTP_TIMEOUT_MS),
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Custom-Charset-Response': 'UTF-8',
          ...options.headers,
          Cookie: this.cookieHeader ?? '',
        },
      });
    } catch (error: unknown) {
      if (options.method === 'POST') {
        throw new NonRetryableJobError(
          `Falha de rede após iniciar POST ${path}; resultado no Syonet é ambíguo e exige conciliação`,
          { cause: error },
        );
      }
      throw error;
    }

    const safeAuthenticationFailure =
      options.method !== 'POST' &&
      (response.status === 401 ||
        response.status === 403 ||
        (response.status >= 300 && response.status < 400));
    if (safeAuthenticationFailure && retry) {
      sessionCache.delete(this.cacheKey);
      this.cookieHeader = null;
      await this.authenticate();
      return this.request<T>(path, options, false);
    }

    if (!response.ok) {
      const message = `Syonet recusou ${options.method ?? 'GET'} ${path}: HTTP ${response.status}`;
      if (options.method === 'POST' || (response.status >= 300 && response.status < 500)) {
        throw new NonRetryableJobError(message);
      }
      throw new Error(message);
    }

    try {
      return (await response.json()) as T;
    } catch (error: unknown) {
      if (options.method === 'POST') {
        throw new NonRetryableJobError(
          `Syonet confirmou POST ${path}, mas retornou uma resposta inválida; exige conciliação`,
          { cause: error },
        );
      }
      throw error;
    }
  }
}

export function clearSyonetSessionCache(): void {
  sessionCache.clear();
}

export async function processLeadViaApi(
  lead: DuotalkLeadData,
  credentials: SyonetCredentials,
  target: SyonetTarget,
  gateway?: SyonetGateway,
): Promise<LeadProcessResult> {
  const api =
    gateway ??
    new HttpSyonetGateway(
      credentials.url,
      credentials.username,
      credentials.password,
      credentials.version,
    );
  const company = syonetCompanySchema.parse(await api.get<unknown>('/api/sessao/empresa'));
  if (company.idEmpresa !== target.companyId) {
    throw new NonRetryableJobError(
      `A companyId ${target.companyId} não está disponível na sessão do usuário Syonet; empresa ativa: ${company.idEmpresa}`,
      { code: SYONET_COMPANY_ACCESS_DENIED },
    );
  }

  const phone = parsePhoneNumber(lead.telefone);
  const searchParams = new URLSearchParams({
    incluiContatos: 'true',
    status: 'ATIVO',
    telefone: phone.fullWithoutDdi,
    timeZoneId: 'America/Sao_Paulo',
  });
  const clients = syonetClientsSchema.parse(
    await api.get<unknown>(`/api/cliente?${searchParams.toString()}`),
  );
  const existingClient = selectExistingClient(clients, phone.fullWithoutDdi);
  const existingClientId = existingClient ? getNumericId(existingClient) : null;
  if (existingClient && existingClientId === null) {
    throw new NonRetryableJobError(
      'O Syonet retornou o cliente do telefone informado sem um identificador válido',
    );
  }

  const user = syonetUserSchema.parse(await api.get<unknown>('/api/sessao/usuario'));
  const contactForms = syonetContactFormsSchema.parse(
    await api.get<unknown>(`/api/empresa/${company.idEmpresa}/formacontato`),
  );
  const contactForm = selectContactForm(contactForms, lead);
  const eventTypes = syonetEventTypesSchema.parse(
    await api.get<unknown>(
      `/api/usuario/${user.idUsuario}/tipoevento?idEmpresa=${company.idEmpresa}`,
    ),
  );
  const eventType = selectEventType(eventTypes, lead);
  const groupId = eventType.idGrupoEvento;
  const typeId = eventType.idTipoEvento;
  if (!groupId || !typeId) {
    throw new Error('O tipo de evento selecionado não possui grupo ou identificador');
  }

  const media = syonetMediaSchema.parse(
    await api.get<unknown>(
      `/api/empresa/${company.idEmpresa}/grupoevento/${encodeURIComponent(groupId)}/tipoevento/${encodeURIComponent(typeId)}/midia`,
    ),
  );
  const selectedMedia = selectMedia(media, lead);
  const mapping = {
    contactForm,
    eventGroupId: groupId,
    eventTypeId: typeId,
    media: selectedMedia,
  };

  if (lead.dryRun) {
    return {
      clientCreated: false,
      clientId: existingClientId,
      companyId: company.idEmpresa,
      dryRun: true,
      eventId: null,
      mapping,
    };
  }

  let clientId = existingClientId;
  const clientCreated = !existingClient;

  if (clientCreated) {
    const createdClient = parseConfirmedWrite(
      syonetClientSchema,
      await api.post<unknown>('/api/cliente', buildClientPayload(lead, contactForm)),
      'a criação do cliente',
    );
    clientId = getNumericId(createdClient);
    if (clientId === null) {
      throw new NonRetryableJobError(
        'O Syonet respondeu à criação do cliente sem retornar idCliente; exige conciliação',
      );
    }
    logger.info({ clientId }, 'Cliente criado via API HTTP do Syonet');
  } else {
    logger.info({ clientId }, 'Cliente existente localizado pelo telefone no Syonet');
  }

  let createdEvent: z.infer<typeof syonetEventResponseSchema>;
  try {
    createdEvent = parseConfirmedWrite(
      syonetEventResponseSchema,
      await api.post<unknown>('/api/evento', {
        idCliente: clientId,
        idEmpresa: company.idEmpresa,
        idGrupoEvento: groupId,
        idTipoEvento: typeId,
        idAgente: user.idUsuario,
        formaContato: contactForm,
        midia: selectedMedia,
        dataProximaAcao: getNextActionTimestamp(),
        observacao: buildObservation(lead),
        moduloCriacaoEvento: 'EVENTOS',
      }),
      'a criação do evento',
    );
  } catch (error: unknown) {
    if (clientCreated && !(error instanceof NonRetryableJobError)) {
      throw new NonRetryableJobError(
        'Cliente criado, mas a criação da oportunidade não foi confirmada; exige conciliação no Syonet',
        { cause: error },
      );
    }
    throw error;
  }
  const eventId = getNumericId(createdEvent);
  if (eventId === null) {
    throw new NonRetryableJobError(
      'O Syonet respondeu à criação do evento sem retornar idEvento; exige conciliação',
    );
  }

  logger.info({ clientId, eventId }, 'Oportunidade criada via API HTTP do Syonet');
  return {
    clientCreated,
    clientId,
    companyId: company.idEmpresa,
    dryRun: false,
    eventId,
    mapping,
  };
}

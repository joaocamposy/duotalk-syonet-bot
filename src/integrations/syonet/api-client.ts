import { SyonetCredentials, syonetCredentialsSchema } from './credentials.js';
import { LeadJobResult } from '../../queue/types.js';
import { NonRetryableJobError } from '../../queue/job-errors.js';
import { env } from '../../config/env.js';
import { DuotalkLeadData } from '../../types/lead-request.js';
import { logger } from '../../utils/logger.js';
import { parsePhoneNumber } from '../../utils/phone-parser.js';
import { loginAndGetCookiesViaHttp } from './auth-service.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { SyonetTarget } from './target.js';
import {
  selectContactForm,
  selectEventType,
  selectMedia,
  SyonetContactForm,
  SyonetEventType,
  SyonetMedia,
} from './mapping.js';
import { sanitizeSensitiveText } from '../../utils/sensitive-text.js';
import {
  SYONET_COMPANY_ACCESS_DENIED,
  SYONET_CONTRACT_INVALID,
  SYONET_DATA_CONFLICT,
  SYONET_WRITE_REJECTED,
  SYONET_WRITE_REQUIRES_RECONCILIATION,
} from './errors.js';
import { applySyonetTimeZone, SYONET_TIME_ZONE } from './time-zone.js';
import { readSyonetJson } from './response-json.js';

applySyonetTimeZone();

export interface SyonetGateway {
  get<T>(path: string): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}

interface SyonetUser {
  idUsuario: number;
}

interface SyonetCompany {
  idEmpresa: number;
}

interface SyonetClient {
  email?: string | null;
  idCliente?: number;
  id?: number;
  nomeCliente?: string | null;
  telefoneCelular?: unknown;
}

interface SyonetEvent {
  dataEvento?: number | string | null;
  dataInc?: number | string | null;
  encaminhamentoAtivo?: { idEmpresa?: number } | null;
  idEmpresa?: number;
  idEmpresaAtual?: number;
  idEvento?: number;
  idGrupoEvento?: string;
  idStatusEvento?: string;
  idTipoEvento?: string;
  id?: number;
  observacao?: string | null;
  status?: string;
}

interface SyonetAction {
  conclusao?: string | null;
  idAcao?: number | string;
  id?: number | string;
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
  .object({
    email: z.string().nullable().optional(),
    idCliente: numericIdSchema.optional(),
    id: numericIdSchema.optional(),
    nomeCliente: z.string().nullable().optional(),
    telefoneCelular: z.unknown().optional(),
  })
  .passthrough();
const syonetClientsSchema = z.array(syonetClientSchema);
const syonetEventResponseSchema: z.ZodType<SyonetEventResponse> = z.object({
  evento: z
    .object({ idEvento: numericIdSchema.optional(), id: numericIdSchema.optional() })
    .optional(),
  idEvento: numericIdSchema.optional(),
  id: numericIdSchema.optional(),
});
const syonetEventSchema: z.ZodType<SyonetEvent> = z
  .object({
    dataEvento: z.union([z.number(), z.string()]).nullable().optional(),
    dataInc: z.union([z.number(), z.string()]).nullable().optional(),
    encaminhamentoAtivo: z.object({ idEmpresa: numericIdSchema.optional() }).nullable().optional(),
    idEmpresa: numericIdSchema.optional(),
    idEmpresaAtual: numericIdSchema.optional(),
    idEvento: numericIdSchema.optional(),
    idGrupoEvento: z.string().optional(),
    idStatusEvento: z.string().optional(),
    idTipoEvento: z.string().optional(),
    id: numericIdSchema.optional(),
    observacao: z.string().nullable().optional(),
    status: z.string().optional(),
  })
  .passthrough();
const syonetEventsSchema = z.array(syonetEventSchema);
const syonetActionSchema: z.ZodType<SyonetAction> = z
  .object({
    conclusao: z.string().nullable().optional(),
    idAcao: z.union([numericIdSchema, z.string().min(1)]).optional(),
    id: z.union([numericIdSchema, z.string().min(1)]).optional(),
  })
  .passthrough();
const syonetActionsSchema = z.array(syonetActionSchema);
const syonetActionResponseSchema = syonetActionSchema.refine(
  (action) => action.idAcao !== undefined || action.id !== undefined,
  'A ação criada não possui identificador',
);
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
const MAX_EVENT_SEARCH_RESULTS = 200;
const OPEN_EVENT_STATUSES = new Set(['ANDAMENTO', 'AGUARDANDO', 'PENDENTE']);
const OBSERVATION_HEADER = 'Lead recebido via Duotalk';
const CONVERSATION_MARKER_PREFIX = 'Duotalk-Conversation-SHA256:';
const conversationLocks = new Map<string, Promise<void>>();

async function withConversationLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = conversationLocks.get(key) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  conversationLocks.set(key, current);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (conversationLocks.get(key) === current) conversationLocks.delete(key);
  }
}

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
      { cause: parsed.error, code: SYONET_WRITE_REQUIRES_RECONCILIATION },
    );
  }
  return parsed.data;
}

function parseSyonetRead<T>(schema: z.ZodType<T>, value: unknown, operation: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new NonRetryableJobError(`O Syonet retornou um contrato inválido ao ${operation}`, {
      cause: parsed.error,
      code: SYONET_CONTRACT_INVALID,
    });
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
    throw new NonRetryableJobError('Mais de um cliente possui exatamente o telefone informado', {
      code: SYONET_DATA_CONFLICT,
    });
  }
  throw new NonRetryableJobError(
    'O Syonet retornou clientes na pesquisa, mas nenhum possui exatamente o telefone informado',
    { code: SYONET_DATA_CONFLICT },
  );
}

function buildObservation(lead: DuotalkLeadData): string {
  const conversationMarker = lead.idConversa
    ? `${CONVERSATION_MARKER_PREFIX} ${createHash('sha256').update(lead.idConversa).digest('hex')}`
    : null;
  const observation = sanitizeSensitiveText(
    [
      OBSERVATION_HEADER,
      conversationMarker,
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

function hasConversationMarker(
  observation: string | null | undefined,
  idConversa: string,
): boolean {
  if (!observation) return false;
  const lines = observation.split(/\r?\n/).map((line) => line.trim());
  if (lines[0] !== OBSERVATION_HEADER) return false;

  const expectedHash = createHash('sha256').update(idConversa).digest('hex');
  if (lines[1] === `${CONVERSATION_MARKER_PREFIX} ${expectedHash}`) return true;

  // Compatibilidade somente com o cabeçalho legado criado por esta integração.
  return lines[1] === `ID conversa: ${idConversa}`;
}

async function findEventByConversation(
  api: SyonetGateway,
  clientId: number,
  companyId: number,
  idConversa: string,
): Promise<number | null> {
  const searchParams = new URLSearchParams({
    idCliente: String(clientId),
    idEmpresa: String(companyId),
    maxRegistros: String(MAX_EVENT_SEARCH_RESULTS),
    ordenacao: 'DATAEVENTO',
    dataFutura: 'true',
    pagina: '0',
  });
  const events = parseSyonetRead(
    syonetEventsSchema,
    await api.get<unknown>(`/api/evento?${searchParams.toString()}`),
    'pesquisar oportunidades',
  );
  const matches: number[] = [];

  for (const event of events) {
    const eventId = getNumericId(event);
    if (eventId === null) continue;
    const eventWithObservation =
      event.observacao === undefined
        ? parseSyonetRead(
            syonetEventSchema,
            await api.get<unknown>(`/api/evento/${eventId}`),
            'abrir uma oportunidade',
          )
        : event;
    if (hasConversationMarker(eventWithObservation.observacao, idConversa)) {
      matches.push(eventId);
    }
  }

  if (matches.length > 1) {
    throw new NonRetryableJobError(
      'Mais de uma oportunidade do Syonet possui o mesmo identificador de conversa; exige conciliação',
      { code: SYONET_DATA_CONFLICT },
    );
  }
  if (matches.length === 0 && events.length >= MAX_EVENT_SEARCH_RESULTS) {
    throw new NonRetryableJobError(
      'A pesquisa de oportunidades atingiu o limite sem localizar a conversa; exige conciliação para evitar duplicação',
      { code: SYONET_DATA_CONFLICT },
    );
  }
  return matches[0] ?? null;
}

function parseSyonetTimestamp(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const numericValue = Number(value);
  if (Number.isFinite(numericValue)) return numericValue;
  const parsedDate = Date.parse(value);
  return Number.isFinite(parsedDate) ? parsedDate : null;
}

function getEventCompanyId(event: SyonetEvent): number | null {
  return event.idEmpresaAtual ?? event.encaminhamentoAtivo?.idEmpresa ?? event.idEmpresa ?? null;
}

function getEventStatus(event: SyonetEvent): string | null {
  return event.idStatusEvento ?? event.status ?? null;
}

function hasOpenEventPolicyFields(event: SyonetEvent): boolean {
  return Boolean(
    getEventStatus(event) &&
    event.idGrupoEvento &&
    event.idTipoEvento &&
    getEventCompanyId(event) !== null &&
    parseSyonetTimestamp(event.dataEvento ?? event.dataInc) !== null,
  );
}

async function findOpenEventToUpdate(
  api: SyonetGateway,
  clientId: number,
  companyId: number,
  groupId: string,
  typeId: string,
  daysToUpdateOpenEvent: number,
): Promise<number | null> {
  if (daysToUpdateOpenEvent <= 0) return null;

  const searchParams = new URLSearchParams({
    idCliente: String(clientId),
    idEmpresa: String(companyId),
    idGrupoEvento: groupId,
    idTipoEvento: typeId,
    maxRegistros: String(MAX_EVENT_SEARCH_RESULTS),
    ordenacao: 'DATAEVENTO',
    dataFutura: 'true',
    pagina: '0',
  });
  for (const status of OPEN_EVENT_STATUSES) searchParams.append('status', status);

  const events = parseSyonetRead(
    syonetEventsSchema,
    await api.get<unknown>(`/api/evento?${searchParams.toString()}`),
    'pesquisar oportunidades abertas',
  );
  const cutoff = Date.now() - daysToUpdateOpenEvent * 24 * 60 * 60 * 1_000;
  const candidates: Array<{ eventId: number; timestamp: number }> = [];

  for (const summary of events) {
    const eventId = getNumericId(summary);
    if (eventId === null) continue;
    const event = hasOpenEventPolicyFields(summary)
      ? summary
      : parseSyonetRead(
          syonetEventSchema,
          await api.get<unknown>(`/api/evento/${eventId}`),
          'abrir uma oportunidade candidata',
        );
    const timestamp = parseSyonetTimestamp(event.dataEvento ?? event.dataInc);
    if (
      timestamp !== null &&
      timestamp >= cutoff &&
      getEventCompanyId(event) === companyId &&
      event.idGrupoEvento === groupId &&
      event.idTipoEvento === typeId &&
      OPEN_EVENT_STATUSES.has(getEventStatus(event) ?? '')
    ) {
      candidates.push({ eventId, timestamp });
    }
  }

  if (candidates.length === 0 && events.length >= MAX_EVENT_SEARCH_RESULTS) {
    throw new NonRetryableJobError(
      'A pesquisa de oportunidades abertas atingiu o limite sem comprovar a ausência de um evento elegível',
      { code: SYONET_DATA_CONFLICT },
    );
  }
  candidates.sort(
    (left, right) => right.timestamp - left.timestamp || right.eventId - left.eventId,
  );
  return candidates[0]?.eventId ?? null;
}

async function eventAlreadyHasConversationComment(
  api: SyonetGateway,
  eventId: number,
  idConversa: string,
): Promise<boolean> {
  const actions = parseSyonetRead(
    syonetActionsSchema,
    await api.get<unknown>(`/api/evento/${eventId}/acao`),
    'consultar os comentários da oportunidade',
  );
  return actions.some((action) => hasConversationMarker(action.conclusao, idConversa));
}

async function addLeadCommentToEvent(
  api: SyonetGateway,
  eventId: number,
  lead: DuotalkLeadData,
): Promise<void> {
  parseConfirmedWrite(
    syonetActionResponseSchema,
    await api.post<unknown>(`/api/evento/${eventId}/acao`, {
      tipo: 'COMENTARIO',
      resultado: 'PENDENTE',
      conclusao: buildObservation(lead),
    }),
    'a inclusão do comentário na oportunidade',
  );
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

function normalizeComparableText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
}

function buildClientUpdatePayload(
  client: SyonetClient,
  lead: DuotalkLeadData,
): Record<string, unknown> {
  const update: Record<string, unknown> = {};
  if (normalizeComparableText(client.nomeCliente) !== normalizeComparableText(lead.nome)) {
    update.nomeCliente = lead.nome;
  }
  if (lead.email && normalizeComparableText(client.email) !== normalizeComparableText(lead.email)) {
    update.email = lead.email;
  }

  const phone = parsePhoneNumber(lead.telefone);
  if (!collectClientPhones(client.telefoneCelular).has(phone.fullWithoutDdi)) {
    update.telefoneCelular = {
      ddd: phone.ddd,
      numero: phone.number,
    };
  }
  return update;
}

export class HttpSyonetGateway implements SyonetGateway {
  private readonly baseUrl: string;
  private readonly cacheKey: string;
  private cookieHeader: string | null;

  constructor(
    private readonly url: string,
    private readonly user: string,
    private readonly pass: string,
    private readonly processSignal?: AbortSignal,
  ) {
    const validatedCredentials = syonetCredentialsSchema.safeParse({
      url,
      username: user,
      password: pass,
    });
    if (!validatedCredentials.success) {
      throw new NonRetryableJobError('Destino ou credenciais do Syonet recusados pela política');
    }
    this.baseUrl = validatedCredentials.data.url;
    this.cacheKey = createHash('sha256')
      .update(JSON.stringify([this.baseUrl, user, pass]))
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

  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private async authenticate(): Promise<void> {
    this.cookieHeader = await loginAndGetCookiesViaHttp(
      this.url,
      this.user,
      this.pass,
      this.processSignal,
    );
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
        signal: this.processSignal
          ? AbortSignal.any([AbortSignal.timeout(env.SYONET_HTTP_TIMEOUT_MS), this.processSignal])
          : AbortSignal.timeout(env.SYONET_HTTP_TIMEOUT_MS),
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Custom-Charset-Response': 'UTF-8',
          ...options.headers,
          Cookie: this.cookieHeader ?? '',
        },
      });
    } catch (error: unknown) {
      if (options.method === 'POST' || options.method === 'PATCH') {
        throw new NonRetryableJobError(
          `Falha de rede após iniciar ${options.method} ${path}; resultado no Syonet é ambíguo e exige conciliação`,
          { cause: error, code: SYONET_WRITE_REQUIRES_RECONCILIATION },
        );
      }
      throw error;
    }

    const safeAuthenticationFailure =
      options.method !== 'POST' &&
      options.method !== 'PATCH' &&
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
      if (
        options.method === 'POST' ||
        options.method === 'PATCH' ||
        (response.status >= 300 && response.status < 500)
      ) {
        throw new NonRetryableJobError(message, {
          code:
            response.status >= 300 && response.status < 400
              ? SYONET_WRITE_REQUIRES_RECONCILIATION
              : SYONET_WRITE_REJECTED,
        });
      }
      throw new Error(message);
    }

    try {
      return (await readSyonetJson(response)) as T;
    } catch (error: unknown) {
      if (options.method === 'POST' || options.method === 'PATCH') {
        throw new NonRetryableJobError(
          `Syonet confirmou ${options.method} ${path}, mas retornou uma resposta inválida; exige conciliação`,
          { cause: error, code: SYONET_WRITE_REQUIRES_RECONCILIATION },
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
  options: { dryRun?: boolean; daysToUpdateOpenEvent?: number } = {},
): Promise<LeadProcessResult> {
  const api =
    gateway ??
    new HttpSyonetGateway(
      credentials.url,
      credentials.username,
      credentials.password,
      AbortSignal.timeout(env.SYONET_PROCESS_TIMEOUT_MS),
    );
  const company = parseSyonetRead(
    syonetCompanySchema,
    await api.get<unknown>('/api/sessao/empresa'),
    'consultar a empresa ativa',
  );
  if (company.idEmpresa !== target.companyId) {
    throw new NonRetryableJobError(
      `A companyId ${target.companyId} não está disponível na sessão do usuário Syonet; empresa ativa: ${company.idEmpresa}`,
      { code: SYONET_COMPANY_ACCESS_DENIED },
    );
  }

  const daysToUpdateOpenEvent = options.daysToUpdateOpenEvent ?? 0;
  const process = () =>
    processLeadForCompany(lead, company, api, options.dryRun ?? false, daysToUpdateOpenEvent);
  const lockIdentity =
    daysToUpdateOpenEvent > 0
      ? `phone:${parsePhoneNumber(lead.telefone).fullWithoutDdi}`
      : lead.idConversa
        ? `conversation:${lead.idConversa}`
        : null;
  if (!lockIdentity) return process();

  const lockKey = createHash('sha256')
    .update(JSON.stringify([credentials.url, company.idEmpresa, lockIdentity]))
    .digest('hex');
  return withConversationLock(lockKey, process);
}

async function processLeadForCompany(
  lead: DuotalkLeadData,
  company: SyonetCompany,
  api: SyonetGateway,
  dryRun: boolean,
  daysToUpdateOpenEvent: number,
): Promise<LeadProcessResult> {
  const phone = parsePhoneNumber(lead.telefone);
  const searchParams = new URLSearchParams({
    incluiContatos: 'true',
    status: 'ATIVO',
    telefone: phone.fullWithoutDdi,
    timeZoneId: SYONET_TIME_ZONE,
  });
  const clients = parseSyonetRead(
    syonetClientsSchema,
    await api.get<unknown>(`/api/cliente?${searchParams.toString()}`),
    'pesquisar clientes',
  );
  const existingClient = selectExistingClient(clients, phone.fullWithoutDdi);
  const existingClientId = existingClient ? getNumericId(existingClient) : null;
  if (existingClient && existingClientId === null) {
    throw new NonRetryableJobError(
      'O Syonet retornou o cliente do telefone informado sem um identificador válido',
    );
  }
  const detailedExistingClient =
    existingClientId !== null
      ? parseSyonetRead(
          syonetClientSchema,
          await api.get<unknown>(`/api/cliente/${existingClientId}`),
          'abrir o cadastro do cliente',
        )
      : null;
  if (detailedExistingClient && getNumericId(detailedExistingClient) !== existingClientId) {
    throw new NonRetryableJobError(
      'O Syonet retornou um identificador divergente ao abrir o cadastro do cliente',
    );
  }
  const clientUpdatePayload = detailedExistingClient
    ? buildClientUpdatePayload(detailedExistingClient, lead)
    : {};

  const user = parseSyonetRead(
    syonetUserSchema,
    await api.get<unknown>('/api/sessao/usuario'),
    'consultar o usuário da sessão',
  );
  const contactForms = parseSyonetRead(
    syonetContactFormsSchema,
    await api.get<unknown>(`/api/empresa/${company.idEmpresa}/formacontato`),
    'consultar as formas de contato',
  );
  const contactForm = selectContactForm(contactForms, lead);
  const eventTypes = parseSyonetRead(
    syonetEventTypesSchema,
    await api.get<unknown>(
      `/api/usuario/${user.idUsuario}/tipoevento?idEmpresa=${company.idEmpresa}`,
    ),
    'consultar os tipos de evento',
  );
  const eventType = selectEventType(eventTypes, lead);
  const groupId = eventType.idGrupoEvento;
  const typeId = eventType.idTipoEvento;
  if (!groupId || !typeId) {
    throw new NonRetryableJobError(
      'O tipo de evento selecionado não possui grupo ou identificador',
      { code: SYONET_CONTRACT_INVALID },
    );
  }

  const media = parseSyonetRead(
    syonetMediaSchema,
    await api.get<unknown>(
      `/api/empresa/${company.idEmpresa}/grupoevento/${encodeURIComponent(groupId)}/tipoevento/${encodeURIComponent(typeId)}/midia`,
    ),
    'consultar as mídias do evento',
  );
  const selectedMedia = selectMedia(media, lead);
  const mapping = {
    contactForm,
    eventGroupId: groupId,
    eventTypeId: typeId,
    media: selectedMedia,
  };

  if (dryRun) {
    return {
      clientCreated: false,
      clientUpdated: false,
      clientId: existingClientId,
      companyId: company.idEmpresa,
      dryRun: true,
      eventCreated: false,
      eventId: null,
      mapping,
    };
  }

  let clientId = existingClientId;
  const clientCreated = !existingClient;
  let clientUpdated = false;

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
    if (Object.keys(clientUpdatePayload).length > 0) {
      const updatedClient = parseConfirmedWrite(
        syonetClientSchema,
        await api.patch<unknown>(`/api/cliente/${clientId}`, clientUpdatePayload),
        'a atualização do cliente',
      );
      if (getNumericId(updatedClient) !== clientId) {
        throw new NonRetryableJobError(
          'O Syonet respondeu à atualização com idCliente divergente; exige conciliação',
        );
      }
      clientUpdated = true;
      logger.info({ clientId }, 'Cliente existente atualizado via API HTTP do Syonet');
    } else {
      logger.info({ clientId }, 'Cliente existente já possui os dados atuais do lead');
    }
  }

  if (clientId === null) {
    throw new NonRetryableJobError('Não foi possível determinar o cliente da oportunidade');
  }

  const existingEventId =
    !clientCreated && lead.idConversa
      ? await findEventByConversation(api, clientId, company.idEmpresa, lead.idConversa)
      : null;
  if (existingEventId !== null) {
    logger.info(
      { clientId, eventId: existingEventId },
      'Oportunidade existente reutilizada pelo identificador da conversa',
    );
    return {
      clientCreated,
      clientUpdated,
      clientId,
      companyId: company.idEmpresa,
      dryRun: false,
      eventCreated: false,
      eventId: existingEventId,
      mapping,
    };
  }

  const openEventId =
    !clientCreated && daysToUpdateOpenEvent > 0
      ? await findOpenEventToUpdate(
          api,
          clientId,
          company.idEmpresa,
          groupId,
          typeId,
          daysToUpdateOpenEvent,
        )
      : null;
  if (openEventId !== null) {
    const commentAlreadyExists = lead.idConversa
      ? await eventAlreadyHasConversationComment(api, openEventId, lead.idConversa)
      : false;
    if (!commentAlreadyExists) {
      try {
        await addLeadCommentToEvent(api, openEventId, lead);
      } catch (error: unknown) {
        throw new NonRetryableJobError(
          'A inclusão do comentário na oportunidade aberta não foi confirmada; exige conciliação no Syonet',
          { cause: error, code: SYONET_WRITE_REQUIRES_RECONCILIATION },
        );
      }
    }
    logger.info(
      { clientId, eventId: openEventId, commentAdded: !commentAlreadyExists },
      'Oportunidade aberta reutilizada pela política de dias',
    );
    return {
      clientCreated,
      clientUpdated,
      clientId,
      companyId: company.idEmpresa,
      dryRun: false,
      eventCreated: false,
      eventId: openEventId,
      mapping,
    };
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
    if (clientCreated || clientUpdated) {
      throw new NonRetryableJobError(
        'Cliente criado ou atualizado, mas a criação da oportunidade não foi confirmada; exige conciliação no Syonet',
        { cause: error, code: SYONET_WRITE_REQUIRES_RECONCILIATION },
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
    clientUpdated,
    clientId,
    companyId: company.idEmpresa,
    dryRun: false,
    eventCreated: true,
    eventId,
    mapping,
  };
}

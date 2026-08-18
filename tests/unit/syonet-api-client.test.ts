import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearSyonetSessionCache,
  HttpSyonetGateway,
  processLeadViaApi,
  SyonetGateway,
} from '../../src/crawler/syonet-api-client.js';
import { DuotalkLeadData } from '../../src/types/duotalk-payload.js';
import { SyonetCredentials } from '../../src/credentials/credential-envelope.js';

const credentials: SyonetCredentials = {
  url: 'https://crm.example.com',
  username: 'usuario',
  password: 'senha',
};
const target = { companyId: 25 };

const { publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

class RecordingGateway implements SyonetGateway {
  readonly getPaths: string[] = [];
  readonly posts: Array<{ path: string; body: unknown }> = [];
  readonly operations: string[] = [];

  constructor(private readonly responses: Map<string, unknown>) {}

  async get<T>(path: string): Promise<T> {
    this.getPaths.push(path);
    this.operations.push(`GET ${path}`);
    if (!this.responses.has(path)) throw new Error(`Resposta não configurada para GET ${path}`);
    return this.responses.get(path) as T;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    this.posts.push({ path, body });
    this.operations.push(`POST ${path}`);
    if (!this.responses.has(`POST ${path}`)) {
      throw new Error(`Resposta não configurada para POST ${path}`);
    }
    return this.responses.get(`POST ${path}`) as T;
  }
}

function makeLead(overrides: Partial<DuotalkLeadData> = {}): DuotalkLeadData {
  return {
    nome: 'Lead Teste',
    telefone: '5561993351327',
    email: 'lead@example.com',
    origem: 'Outbound',
    canal: 'WhatsApp 360',
    qualificacaoLead: 'Lead',
    intermediario: 'Duotalk',
    intencao: 'DVNU - Veículos Novos',
    ...overrides,
  };
}

function makeSuccessfulResponses(searchResult: unknown): Map<string, unknown> {
  return new Map<string, unknown>([
    [
      '/api/cliente?incluiContatos=true&status=ATIVO&telefone=61993351327&timeZoneId=America%2FSao_Paulo',
      searchResult,
    ],
    ['/api/sessao/usuario', { idUsuario: 1671 }],
    ['/api/sessao/empresa', { idEmpresa: 25 }],
    [
      '/api/empresa/25/formacontato',
      [
        { descricao: 'INTERNET', status: true },
        { descricao: 'WHATSAPP', status: true },
      ],
    ],
    [
      '/api/usuario/1671/tipoevento?idEmpresa=25',
      [
        {
          ativo: true,
          idGrupoEvento: 'OPORTUNIDADE',
          idTipoEvento: 'NOVOS WEB',
        },
      ],
    ],
    [
      '/api/empresa/25/grupoevento/OPORTUNIDADE/tipoevento/NOVOS%20WEB/midia',
      [{ descricao: 'DUOTALK' }],
    ],
    ['POST /api/cliente', { idCliente: -100 }],
    ['POST /api/evento', { idEvento: 200 }],
  ]);
}

describe('processLeadViaApi', () => {
  afterEach(() => {
    clearSyonetSessionCache();
    vi.unstubAllGlobals();
  });

  it('cria cliente e oportunidade com o contrato usado pelo Syonet', async () => {
    const gateway = new RecordingGateway(makeSuccessfulResponses([]));

    const result = await processLeadViaApi(makeLead(), credentials, target, gateway);

    expect(result).toEqual({
      clientCreated: true,
      clientId: -100,
      companyId: 25,
      dryRun: false,
      eventId: 200,
      mapping: {
        contactForm: 'WHATSAPP',
        eventGroupId: 'OPORTUNIDADE',
        eventTypeId: 'NOVOS WEB',
        media: 'DUOTALK',
      },
    });
    expect(gateway.posts).toHaveLength(2);
    expect(gateway.operations.slice(-2)).toEqual(['POST /api/cliente', 'POST /api/evento']);

    const clientPayload = gateway.posts[0].body as Record<string, unknown>;
    expect(gateway.posts[0].path).toBe('/api/cliente');
    expect(clientPayload).toMatchObject({
      nomeCliente: 'Lead Teste',
      origem: 'WHATSAPP',
      tipoPessoa: 'FISICA',
      telefoneCelular: { ddd: '61', numero: '993351327' },
      validateFields: false,
    });
    expect(clientPayload).not.toHaveProperty('sexo');

    expect(gateway.posts[1]).toMatchObject({
      path: '/api/evento',
      body: {
        idCliente: -100,
        idEmpresa: 25,
        idGrupoEvento: 'OPORTUNIDADE',
        idTipoEvento: 'NOVOS WEB',
        idAgente: 1671,
        formaContato: 'WHATSAPP',
        midia: 'DUOTALK',
        moduloCriacaoEvento: 'EVENTOS',
      },
    });
  });

  it('reutiliza cliente encontrado e cria somente a oportunidade', async () => {
    const gateway = new RecordingGateway(
      makeSuccessfulResponses([
        { idCliente: -55, telefoneCelular: { ddd: '61', numero: '993351327' } },
      ]),
    );

    const result = await processLeadViaApi(makeLead(), credentials, target, gateway);

    expect(result.clientCreated).toBe(false);
    expect(result.clientId).toBe(-55);
    expect(gateway.posts.map((post) => post.path)).toEqual(['/api/evento']);
  });

  it('não repete o fluxo inteiro quando o cliente foi criado e o evento ficou ambíguo', async () => {
    const responses = makeSuccessfulResponses([]);
    responses.delete('POST /api/evento');
    const gateway = new RecordingGateway(responses);

    await expect(processLeadViaApi(makeLead(), credentials, target, gateway)).rejects.toMatchObject(
      {
        name: 'NonRetryableJobError',
        message:
          'Cliente criado, mas a criação da oportunidade não foi confirmada; exige conciliação no Syonet',
      },
    );
    expect(gateway.posts.map((post) => post.path)).toEqual(['/api/cliente', '/api/evento']);
  });

  it('não associa a oportunidade quando o resultado não possui o telefone exato', async () => {
    const gateway = new RecordingGateway(
      makeSuccessfulResponses([
        { idCliente: -55, telefoneCelular: { ddd: '61', numero: '999999999' } },
      ]),
    );

    await expect(processLeadViaApi(makeLead(), credentials, target, gateway)).rejects.toThrow(
      'nenhum possui exatamente o telefone',
    );
    expect(gateway.posts).toHaveLength(0);
  });

  it('não recria cliente localizado quando a resposta não contém ID reconhecível', async () => {
    const gateway = new RecordingGateway(
      makeSuccessfulResponses([{ telefoneCelular: { ddd: '61', numero: '993351327' } }]),
    );

    await expect(processLeadViaApi(makeLead(), credentials, target, gateway)).rejects.toThrow(
      'sem um identificador válido',
    );
    expect(gateway.posts).toHaveLength(0);
  });

  it('não grava cliente nem evento no modo dry-run', async () => {
    const gateway = new RecordingGateway(makeSuccessfulResponses([]));

    const result = await processLeadViaApi(
      makeLead({ dryRun: true }),
      credentials,
      target,
      gateway,
    );

    expect(result).toEqual({
      clientCreated: false,
      clientId: null,
      companyId: 25,
      dryRun: true,
      eventId: null,
      mapping: {
        contactForm: 'WHATSAPP',
        eventGroupId: 'OPORTUNIDADE',
        eventTypeId: 'NOVOS WEB',
        media: 'DUOTALK',
      },
    });
    expect(gateway.posts).toHaveLength(0);
    expect(gateway.getPaths).toHaveLength(6);
  });

  it('valida o de/para no dry-run e falha sem executar POST', async () => {
    const responses = makeSuccessfulResponses([]);
    responses.set('/api/usuario/1671/tipoevento?idEmpresa=25', [
      {
        ativo: true,
        idGrupoEvento: 'OPORTUNIDADE',
        idTipoEvento: 'POS-VENDA',
      },
    ]);
    const gateway = new RecordingGateway(responses);

    await expect(
      processLeadViaApi(makeLead({ dryRun: true }), credentials, target, gateway),
    ).rejects.toMatchObject({ code: 'SYONET_EVENT_TYPE_MAPPING_NOT_FOUND' });
    expect(gateway.posts).toHaveLength(0);
  });

  it('recusa contrato inválido na resposta de pesquisa', async () => {
    const responses = makeSuccessfulResponses({ resultado: [] });
    const gateway = new RecordingGateway(responses);

    await expect(
      processLeadViaApi(makeLead({ dryRun: true }), credentials, target, gateway),
    ).rejects.toThrow();
    expect(gateway.posts).toHaveLength(0);
  });

  it('recusa companyId diferente da empresa ativa antes de qualquer escrita', async () => {
    const gateway = new RecordingGateway(makeSuccessfulResponses([]));

    await expect(
      processLeadViaApi(makeLead(), credentials, { companyId: 99 }, gateway),
    ).rejects.toMatchObject({
      name: 'NonRetryableJobError',
      code: 'SYONET_COMPANY_ACCESS_DENIED',
    });
    expect(gateway.posts).toHaveLength(0);
    expect(gateway.getPaths).toEqual(['/api/sessao/empresa']);
  });

  it('não renova a sessão nem repete um POST recusado por autenticação', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('', {
          status: 200,
          headers: { 'set-cookie': 'JSESSIONID=initial; Path=/' },
        }),
      )
      .mockResolvedValueOnce(Response.json({ valor: publicKey }, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { 'set-cookie': 'JSESSIONID=authenticated; Path=/' },
        }),
      )
      .mockResolvedValueOnce(Response.json({ idUsuario: 1671 }, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ message: 'sessão expirada' }, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new HttpSyonetGateway(
      credentials.url,
      credentials.username,
      credentials.password,
    );

    await expect(gateway.post('/api/cliente', {})).rejects.toMatchObject({
      name: 'NonRetryableJobError',
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(
      fetchMock.mock.calls.filter(
        (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
      ),
    ).toHaveLength(2);
  });
});

import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearSyonetSessionCache,
  HttpSyonetGateway,
  processLeadViaApi,
  SyonetGateway,
} from '../../src/integrations/syonet/api-client.js';
import { DuotalkLeadData } from '../../src/types/lead-request.js';
import { SyonetCredentials } from '../../src/integrations/syonet/credentials.js';

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
  readonly patches: Array<{ path: string; body: unknown }> = [];
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

  async patch<T>(path: string, body: unknown): Promise<T> {
    this.patches.push({ path, body });
    this.operations.push(`PATCH ${path}`);
    if (!this.responses.has(`PATCH ${path}`)) {
      throw new Error(`Resposta não configurada para PATCH ${path}`);
    }
    return this.responses.get(`PATCH ${path}`) as T;
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
      clientUpdated: false,
      clientId: -100,
      companyId: 25,
      dryRun: false,
      eventCreated: true,
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

  it('reutiliza sem PATCH quando o cliente já possui os dados atuais', async () => {
    const responses = makeSuccessfulResponses([
      {
        idCliente: -55,
        nomeCliente: 'Lead Teste',
        email: 'lead@example.com',
        telefoneCelular: { ddd: '61', numero: '993351327' },
      },
    ]);
    responses.set('/api/cliente/-55', {
      idCliente: -55,
      nomeCliente: 'Lead Teste',
      email: 'LEAD@example.com',
      telefoneCelular: { ddd: '61', numero: '993351327' },
    });
    const gateway = new RecordingGateway(responses);

    const result = await processLeadViaApi(makeLead(), credentials, target, gateway);

    expect(result.clientCreated).toBe(false);
    expect(result.clientUpdated).toBe(false);
    expect(result.clientId).toBe(-55);
    expect(gateway.patches).toHaveLength(0);
    expect(gateway.posts.map((post) => post.path)).toEqual(['/api/evento']);
  });

  it('reutiliza a oportunidade da mesma conversa sem criar outro evento', async () => {
    const responses = makeSuccessfulResponses([
      {
        idCliente: -55,
        nomeCliente: 'Lead Teste',
        email: 'lead@example.com',
        telefoneCelular: { ddd: '61', numero: '993351327' },
      },
    ]);
    responses.set('/api/cliente/-55', {
      idCliente: -55,
      nomeCliente: 'Lead Teste',
      email: 'lead@example.com',
      telefoneCelular: { ddd: '61', numero: '993351327' },
    });
    responses.set(
      '/api/evento?idCliente=-55&idEmpresa=25&maxRegistros=200&ordenacao=DATAEVENTO&dataFutura=true&pagina=0',
      [
        {
          idEvento: 321,
          observacao: 'Lead recebido via Duotalk\nID conversa: conversa-123\nCanal: WhatsApp 360',
        },
      ],
    );
    const gateway = new RecordingGateway(responses);

    const result = await processLeadViaApi(
      makeLead({ idConversa: 'conversa-123' }),
      credentials,
      target,
      gateway,
    );

    expect(result).toMatchObject({ eventCreated: false, eventId: 321 });
    expect(gateway.posts).toHaveLength(0);
  });

  it('não aceita marcador de conversa injetado no texto livre da observação', async () => {
    const responses = makeSuccessfulResponses([
      {
        idCliente: -55,
        nomeCliente: 'Lead Teste',
        email: 'lead@example.com',
        telefoneCelular: { ddd: '61', numero: '993351327' },
      },
    ]);
    responses.set('/api/cliente/-55', {
      idCliente: -55,
      nomeCliente: 'Lead Teste',
      email: 'lead@example.com',
      telefoneCelular: { ddd: '61', numero: '993351327' },
    });
    responses.set(
      '/api/evento?idCliente=-55&idEmpresa=25&maxRegistros=200&ordenacao=DATAEVENTO&dataFutura=true&pagina=0',
      [
        {
          idEvento: 321,
          observacao:
            'Lead recebido via Duotalk\nID conversa: conversa-anterior\nMensagem: texto livre\nID conversa: conversa-alvo',
        },
      ],
    );
    const gateway = new RecordingGateway(responses);

    const result = await processLeadViaApi(
      makeLead({ idConversa: 'conversa-alvo' }),
      credentials,
      target,
      gateway,
    );

    expect(result).toMatchObject({ eventCreated: true, eventId: 200 });
    expect(gateway.posts.map((post) => post.path)).toEqual(['/api/evento']);
  });

  it('não cria oportunidade quando a pesquisa atinge o limite sem localizar a conversa', async () => {
    const responses = makeSuccessfulResponses([
      {
        idCliente: -55,
        nomeCliente: 'Lead Teste',
        email: 'lead@example.com',
        telefoneCelular: { ddd: '61', numero: '993351327' },
      },
    ]);
    responses.set('/api/cliente/-55', {
      idCliente: -55,
      nomeCliente: 'Lead Teste',
      email: 'lead@example.com',
      telefoneCelular: { ddd: '61', numero: '993351327' },
    });
    responses.set(
      '/api/evento?idCliente=-55&idEmpresa=25&maxRegistros=200&ordenacao=DATAEVENTO&dataFutura=true&pagina=0',
      Array.from({ length: 200 }, (_, index) => ({
        idEvento: index + 1,
        observacao: `Lead recebido via Duotalk\nID conversa: conversa-${index}`,
      })),
    );
    const gateway = new RecordingGateway(responses);

    await expect(
      processLeadViaApi(
        makeLead({ idConversa: 'conversa-fora-do-limite' }),
        credentials,
        target,
        gateway,
      ),
    ).rejects.toMatchObject({
      name: 'NonRetryableJobError',
      code: 'SYONET_DATA_CONFLICT',
    });
    expect(gateway.posts).toHaveLength(0);
  });

  it('cria outra oportunidade quando o cliente inicia uma conversa diferente', async () => {
    const responses = makeSuccessfulResponses([
      {
        idCliente: -55,
        nomeCliente: 'Lead Teste',
        email: 'lead@example.com',
        telefoneCelular: { ddd: '61', numero: '993351327' },
      },
    ]);
    responses.set('/api/cliente/-55', {
      idCliente: -55,
      nomeCliente: 'Lead Teste',
      email: 'lead@example.com',
      telefoneCelular: { ddd: '61', numero: '993351327' },
    });
    responses.set(
      '/api/evento?idCliente=-55&idEmpresa=25&maxRegistros=200&ordenacao=DATAEVENTO&dataFutura=true&pagina=0',
      [{ idEvento: 321, observacao: 'ID conversa: conversa-anterior' }],
    );
    const gateway = new RecordingGateway(responses);

    const result = await processLeadViaApi(
      makeLead({ idConversa: 'conversa-nova' }),
      credentials,
      target,
      gateway,
    );

    expect(result).toMatchObject({ eventCreated: true, eventId: 200 });
    expect(gateway.posts.map((post) => post.path)).toEqual(['/api/evento']);
  });

  it('adiciona a nova observação como comentário em oportunidade aberta dentro da janela', async () => {
    const responses = makeSuccessfulResponses([
      {
        idCliente: -55,
        nomeCliente: 'Lead Teste',
        email: 'lead@example.com',
        telefoneCelular: { ddd: '61', numero: '993351327' },
      },
    ]);
    responses.set('/api/cliente/-55', {
      idCliente: -55,
      nomeCliente: 'Lead Teste',
      email: 'lead@example.com',
      telefoneCelular: { ddd: '61', numero: '993351327' },
    });
    responses.set(
      '/api/evento?idCliente=-55&idEmpresa=25&maxRegistros=200&ordenacao=DATAEVENTO&dataFutura=true&pagina=0',
      [],
    );
    responses.set(
      '/api/evento?idCliente=-55&idEmpresa=25&idGrupoEvento=OPORTUNIDADE&idTipoEvento=NOVOS+WEB&maxRegistros=200&ordenacao=DATAEVENTO&dataFutura=true&pagina=0&status=ANDAMENTO&status=AGUARDANDO&status=PENDENTE',
      [
        {
          idEvento: 321,
          idEmpresa: 25,
          idGrupoEvento: 'OPORTUNIDADE',
          idTipoEvento: 'NOVOS WEB',
          status: 'ANDAMENTO',
          dataEvento: Date.now() - 2 * 24 * 60 * 60 * 1_000,
        },
      ],
    );
    responses.set('/api/evento/321/acao', []);
    responses.set('POST /api/evento/321/acao', { idAcao: '987' });
    const gateway = new RecordingGateway(responses);

    const result = await processLeadViaApi(
      makeLead({ idConversa: 'conversa-nova', mensagem: 'Nova observação' }),
      credentials,
      target,
      gateway,
      { daysToUpdateOpenEvent: 30 },
    );

    expect(result).toMatchObject({ eventCreated: false, eventId: 321 });
    expect(gateway.posts).toHaveLength(1);
    expect(gateway.posts[0]).toMatchObject({
      path: '/api/evento/321/acao',
      body: {
        tipo: 'COMENTARIO',
        resultado: 'PENDENTE',
      },
    });
    expect((gateway.posts[0].body as Record<string, string>).conclusao).toContain(
      'Nova observação',
    );
  });

  it('não repete o comentário quando a conversa já está registrada na oportunidade aberta', async () => {
    const responses = makeSuccessfulResponses([
      {
        idCliente: -55,
        nomeCliente: 'Lead Teste',
        email: 'lead@example.com',
        telefoneCelular: { ddd: '61', numero: '993351327' },
      },
    ]);
    responses.set('/api/cliente/-55', {
      idCliente: -55,
      nomeCliente: 'Lead Teste',
      email: 'lead@example.com',
      telefoneCelular: { ddd: '61', numero: '993351327' },
    });
    responses.set(
      '/api/evento?idCliente=-55&idEmpresa=25&maxRegistros=200&ordenacao=DATAEVENTO&dataFutura=true&pagina=0',
      [],
    );
    responses.set(
      '/api/evento?idCliente=-55&idEmpresa=25&idGrupoEvento=OPORTUNIDADE&idTipoEvento=NOVOS+WEB&maxRegistros=200&ordenacao=DATAEVENTO&dataFutura=true&pagina=0&status=ANDAMENTO&status=AGUARDANDO&status=PENDENTE',
      [
        {
          idEvento: 321,
          idEmpresa: 25,
          idGrupoEvento: 'OPORTUNIDADE',
          idTipoEvento: 'NOVOS WEB',
          status: 'AGUARDANDO',
          dataEvento: Date.now(),
        },
      ],
    );
    responses.set('/api/evento/321/acao', [
      {
        idAcao: 900,
        conclusao: 'Lead recebido via Duotalk\nID conversa: conversa-nova',
      },
    ]);
    const gateway = new RecordingGateway(responses);

    const result = await processLeadViaApi(
      makeLead({ idConversa: 'conversa-nova' }),
      credentials,
      target,
      gateway,
      { daysToUpdateOpenEvent: 30 },
    );

    expect(result).toMatchObject({ eventCreated: false, eventId: 321 });
    expect(gateway.posts).toHaveLength(0);
  });

  it('cria uma oportunidade quando o evento aberto está fora da janela', async () => {
    const responses = makeSuccessfulResponses([
      {
        idCliente: -55,
        nomeCliente: 'Lead Teste',
        email: 'lead@example.com',
        telefoneCelular: { ddd: '61', numero: '993351327' },
      },
    ]);
    responses.set('/api/cliente/-55', {
      idCliente: -55,
      nomeCliente: 'Lead Teste',
      email: 'lead@example.com',
      telefoneCelular: { ddd: '61', numero: '993351327' },
    });
    responses.set(
      '/api/evento?idCliente=-55&idEmpresa=25&maxRegistros=200&ordenacao=DATAEVENTO&dataFutura=true&pagina=0',
      [],
    );
    responses.set(
      '/api/evento?idCliente=-55&idEmpresa=25&idGrupoEvento=OPORTUNIDADE&idTipoEvento=NOVOS+WEB&maxRegistros=200&ordenacao=DATAEVENTO&dataFutura=true&pagina=0&status=ANDAMENTO&status=AGUARDANDO&status=PENDENTE',
      [
        {
          idEvento: 321,
          idEmpresa: 25,
          idGrupoEvento: 'OPORTUNIDADE',
          idTipoEvento: 'NOVOS WEB',
          status: 'PENDENTE',
          dataEvento: Date.now() - 31 * 24 * 60 * 60 * 1_000,
        },
      ],
    );
    const gateway = new RecordingGateway(responses);

    const result = await processLeadViaApi(
      makeLead({ idConversa: 'conversa-nova' }),
      credentials,
      target,
      gateway,
      { daysToUpdateOpenEvent: 30 },
    );

    expect(result).toMatchObject({ eventCreated: true, eventId: 200 });
    expect(gateway.posts.map((post) => post.path)).toEqual(['/api/evento']);
  });

  it('serializa processamentos simultâneos da mesma conversa', async () => {
    const responses = makeSuccessfulResponses([
      {
        idCliente: -55,
        nomeCliente: 'Lead Teste',
        email: 'lead@example.com',
        telefoneCelular: { ddd: '61', numero: '993351327' },
      },
    ]);
    responses.set('/api/cliente/-55', {
      idCliente: -55,
      nomeCliente: 'Lead Teste',
      email: 'lead@example.com',
      telefoneCelular: { ddd: '61', numero: '993351327' },
    });
    const baseGateway = new RecordingGateway(responses);
    const eventSearchPath =
      '/api/evento?idCliente=-55&idEmpresa=25&maxRegistros=200&ordenacao=DATAEVENTO&dataFutura=true&pagina=0';
    let eventCreated = false;
    let eventPosts = 0;
    const gateway: SyonetGateway = {
      get: async <T>(path: string): Promise<T> => {
        if (path === eventSearchPath) {
          return (
            eventCreated
              ? [
                  {
                    idEvento: 200,
                    observacao: 'Lead recebido via Duotalk\nID conversa: conversa-simultanea',
                  },
                ]
              : []
          ) as T;
        }
        return baseGateway.get<T>(path);
      },
      patch: <T>(path: string, body: unknown) => baseGateway.patch<T>(path, body),
      post: async <T>(path: string, body: unknown): Promise<T> => {
        if (path === '/api/evento') {
          eventPosts++;
          eventCreated = true;
        }
        return baseGateway.post<T>(path, body);
      },
    };
    const lead = makeLead({ idConversa: 'conversa-simultanea' });

    const results = await Promise.all([
      processLeadViaApi(lead, credentials, target, gateway),
      processLeadViaApi(lead, credentials, target, gateway),
    ]);

    expect(eventPosts).toBe(1);
    expect(results.map((result) => result.eventCreated).sort()).toEqual([false, true]);
    expect(results.map((result) => result.eventId)).toEqual([200, 200]);
  });

  it('abre e atualiza parcialmente o cliente desatualizado antes da oportunidade', async () => {
    const responses = makeSuccessfulResponses([
      { idCliente: -55, telefoneCelular: { ddd: '61', numero: '993351327' } },
    ]);
    responses.set('/api/cliente/-55', {
      idCliente: -55,
      nomeCliente: 'Nome Antigo',
      email: null,
      telefoneCelular: { ddd: '61', numero: '993351327' },
    });
    responses.set('PATCH /api/cliente/-55', {
      idCliente: -55,
      nomeCliente: 'Lead Teste',
      email: 'lead@example.com',
    });
    const gateway = new RecordingGateway(responses);

    const result = await processLeadViaApi(makeLead(), credentials, target, gateway);

    expect(result.clientCreated).toBe(false);
    expect(result.clientUpdated).toBe(true);
    expect(gateway.patches).toEqual([
      {
        path: '/api/cliente/-55',
        body: { nomeCliente: 'Lead Teste', email: 'lead@example.com' },
      },
    ]);
    expect(gateway.operations.slice(-2)).toEqual(['PATCH /api/cliente/-55', 'POST /api/evento']);
  });

  it('atualiza o telefone celular principal quando o número foi localizado em outro contato', async () => {
    const responses = makeSuccessfulResponses([
      {
        idCliente: -55,
        telefones: [{ tipo: 'COMERCIAL', ddd: '61', numero: '993351327' }],
      },
    ]);
    responses.set('/api/cliente/-55', {
      idCliente: -55,
      nomeCliente: 'Lead Teste',
      email: 'lead@example.com',
      telefoneCelular: { ddd: '61', numero: '988888888' },
      telefones: [{ tipo: 'COMERCIAL', ddd: '61', numero: '993351327' }],
    });
    responses.set('PATCH /api/cliente/-55', { idCliente: -55 });
    const gateway = new RecordingGateway(responses);

    await processLeadViaApi(makeLead(), credentials, target, gateway);

    expect(gateway.patches[0]).toEqual({
      path: '/api/cliente/-55',
      body: { telefoneCelular: { ddd: '61', numero: '993351327' } },
    });
  });

  it('não repete o fluxo inteiro quando o cliente foi criado e o evento ficou ambíguo', async () => {
    const responses = makeSuccessfulResponses([]);
    responses.delete('POST /api/evento');
    const gateway = new RecordingGateway(responses);

    await expect(processLeadViaApi(makeLead(), credentials, target, gateway)).rejects.toMatchObject(
      {
        name: 'NonRetryableJobError',
        message:
          'Cliente criado ou atualizado, mas a criação da oportunidade não foi confirmada; exige conciliação no Syonet',
        code: 'SYONET_WRITE_REQUIRES_RECONCILIATION',
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

    const result = await processLeadViaApi(makeLead(), credentials, target, gateway, {
      dryRun: true,
    });

    expect(result).toEqual({
      clientCreated: false,
      clientUpdated: false,
      clientId: null,
      companyId: 25,
      dryRun: true,
      eventCreated: false,
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

  it('abre mas não atualiza cliente desatualizado no modo dry-run', async () => {
    const responses = makeSuccessfulResponses([
      { idCliente: -55, telefoneCelular: { ddd: '61', numero: '993351327' } },
    ]);
    responses.set('/api/cliente/-55', {
      idCliente: -55,
      nomeCliente: 'Nome Antigo',
      telefoneCelular: { ddd: '61', numero: '993351327' },
    });
    const gateway = new RecordingGateway(responses);

    const result = await processLeadViaApi(makeLead(), credentials, target, gateway, {
      dryRun: true,
    });

    expect(result).toMatchObject({
      clientCreated: false,
      clientUpdated: false,
      clientId: -55,
      dryRun: true,
    });
    expect(gateway.getPaths).toContain('/api/cliente/-55');
    expect(gateway.patches).toHaveLength(0);
    expect(gateway.posts).toHaveLength(0);
  });

  it('valida o de/para no dry-run e falha sem executar escrita', async () => {
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
      processLeadViaApi(makeLead(), credentials, target, gateway, { dryRun: true }),
    ).rejects.toMatchObject({ code: 'SYONET_EVENT_TYPE_MAPPING_NOT_FOUND' });
    expect(gateway.posts).toHaveLength(0);
  });

  it('recusa contrato inválido na resposta de pesquisa', async () => {
    const responses = makeSuccessfulResponses({ resultado: [] });
    const gateway = new RecordingGateway(responses);

    await expect(
      processLeadViaApi(makeLead(), credentials, target, gateway, { dryRun: true }),
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

  it('não renova a sessão nem repete um PATCH recusado por autenticação', async () => {
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

    await expect(gateway.patch('/api/cliente/-55', { nomeCliente: 'Novo' })).rejects.toMatchObject({
      name: 'NonRetryableJobError',
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(
      fetchMock.mock.calls.filter(
        (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
      ),
    ).toHaveLength(1);
  });
});

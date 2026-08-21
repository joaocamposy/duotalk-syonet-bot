import { describe, it, expect } from 'vitest';
import { leadRequestSchema, duotalkLeadDataSchema } from '../../src/types/lead-request.js';

describe('Duotalk Payload Schema Validation', () => {
  it('deve validar com sucesso o payload completo do exemplo do Duotalk', () => {
    const rawPayload = {
      credentials: {
        url: 'https://crm.example.com',
        username: 'usuario',
        password: 'senha',
      },
      target: { companyId: 25 },
      dryRun: true,
      daysToUpdateOpenEvent: 30,
      data: {
        id: '6a79aed2***',
        idConversa: '6a79aed244f***',
        origem: 'Outbound',
        canal: 'WhatsApp 360',
        qualificacaoLead: 'Lead',
        intermediario: 'Duotalk',
        operador: 'Operador Exemplo',
        nome: 'Cliente Exemplo',
        telefone: '5561999998888',
        email: 'cliente@example.com',
        mensagem: 'Mensagem: Conversa criada manualmente \n',
        messageHistory: 'Mensagem: Conversa criada manualmente',
        url_duotalk:
          'https://app.duotalk.io/apps/inbox/start-conversation?name=Cliente%20Exemplo&phone=5561999998888',
        firstMessage: '',
        intencao: 'DVNU - Veículos Novos',
      },
    };

    const parsed = leadRequestSchema.parse(rawPayload);
    expect(parsed.data.nome).toBe('Cliente Exemplo');
    expect(parsed.data.telefone).toBe('5561999998888');
    expect(parsed.data.intencao).toBe('DVNU - Veículos Novos');
    expect(parsed.data.firstMessage).toBe('');
    expect(parsed.target.companyId).toBe(25);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.daysToUpdateOpenEvent).toBe(30);
  });

  it('aceita zero para desativar e recusa dias negativos ou fracionários', () => {
    const request = {
      credentials: {
        url: 'https://crm.example.com',
        username: 'usuario',
        password: 'senha',
      },
      target: { companyId: 25 },
      dryRun: true,
      data: {
        nome: 'Cliente Exemplo',
        telefone: '5561999998888',
      },
    };

    expect(leadRequestSchema.parse({ ...request, daysToUpdateOpenEvent: 0 })).toHaveProperty(
      'daysToUpdateOpenEvent',
      0,
    );
    expect(() => leadRequestSchema.parse({ ...request, daysToUpdateOpenEvent: -1 })).toThrow();
    expect(() => leadRequestSchema.parse({ ...request, daysToUpdateOpenEvent: 1.5 })).toThrow();
  });

  it('recusa dryRun dentro dos dados do lead para evitar gravação acidental', () => {
    expect(() =>
      leadRequestSchema.parse({
        credentials: {
          url: 'https://crm.example.com',
          username: 'usuario',
          password: 'senha',
        },
        target: { companyId: 25 },
        data: {
          nome: 'Cliente Exemplo',
          telefone: '5561999998888',
          dryRun: true,
        },
      }),
    ).toThrow('dryRun é um controle da requisição e deve ficar fora de data');
  });

  it('exige idConversa em gravações e permite omiti-lo somente no dry-run', () => {
    const request = {
      credentials: {
        url: 'https://crm.example.com',
        username: 'usuario',
        password: 'senha',
      },
      target: { companyId: 25 },
      data: {
        nome: 'Cliente Exemplo',
        telefone: '5561999998888',
      },
    };

    expect(() => leadRequestSchema.parse(request)).toThrow(
      'idConversa é obrigatório para gravação',
    );
    expect(() => leadRequestSchema.parse({ ...request, dryRun: true })).not.toThrow();
  });

  it('recusa identificadores com quebra de linha ou outro caractere de controle', () => {
    expect(() =>
      duotalkLeadDataSchema.parse({
        nome: 'Cliente Exemplo',
        telefone: '5561999998888',
        idConversa: 'conversa-original\nID conversa: conversa-injetada',
      }),
    ).toThrow('Identificador não pode conter caracteres de controle');
  });

  it('deve aceitar payload direto de lead sem o envelope data', () => {
    const rawLeadData = {
      nome: 'Maria Silva',
      telefone: '5511988887777',
      email: 'maria@exemplo.com',
      intencao: 'Novos',
    };

    const parsed = duotalkLeadDataSchema.parse(rawLeadData);
    expect(parsed.nome).toBe('Maria Silva');
    expect(parsed.origem).toBe('Outbound'); // Valor default
  });

  it('deve falhar ao receber payload sem nome ou telefone', () => {
    const invalidLead = {
      email: 'semnome@exemplo.com',
    };

    expect(() => duotalkLeadDataSchema.parse(invalidLead)).toThrow();
  });

  it('recusa telefone com DDD inválido antes de criar o job', () => {
    expect(() =>
      duotalkLeadDataSchema.parse({
        nome: 'Telefone inválido',
        telefone: '00123456789',
      }),
    ).toThrow('Telefone brasileiro inválido');
  });

  it('limita o tamanho bruto do telefone antes da normalização', () => {
    expect(() =>
      duotalkLeadDataSchema.parse({
        nome: 'Telefone excessivo',
        telefone: `5561999998888${' '.repeat(30)}`,
      }),
    ).toThrow();
  });

  it('remove credenciais Syonet enviadas indevidamente no payload', () => {
    const parsed = duotalkLeadDataSchema.parse({
      nome: 'Lead sem credenciais no job',
      telefone: '5561999998888',
      syonetUrl: 'https://attacker.example.com',
      syonetUser: 'usuario',
      syonetPass: 'senha',
    });

    expect(parsed).not.toHaveProperty('syonetUrl');
    expect(parsed).not.toHaveProperty('syonetUser');
    expect(parsed).not.toHaveProperty('syonetPass');
  });

  it('exige credenciais separadas e URL HTTPS na requisição', () => {
    const data = {
      nome: 'Lead Teste',
      telefone: '5561999998888',
    };

    expect(() => leadRequestSchema.parse({ data })).toThrow();
    expect(() =>
      leadRequestSchema.parse({
        credentials: { url: 'http://crm.example.com', username: 'usuario', password: 'senha' },
        target: { companyId: 25 },
        data,
      }),
    ).toThrow('HTTPS');

    expect(() =>
      leadRequestSchema.parse({
        credentials: { url: 'https://crm.example.com', username: 'usuario', password: 'senha' },
        target: { companyId: 0 },
        data,
      }),
    ).toThrow();
  });

  it('remove tokens de URLs antes de o lead entrar na fila', () => {
    const parsed = duotalkLeadDataSchema.parse({
      nome: 'Lead com histórico',
      telefone: '5561999998888',
      messageHistory: 'Arquivo: https://api.duotalk.io/file?id=10&token=segredo&name=documento.pdf',
    });

    expect(parsed.messageHistory).toBe(
      'Arquivo: https://api.duotalk.io/file?id=10&token=[REDACTED]&name=documento.pdf',
    );
  });

  it('retém somente o trecho do histórico que pode compor a observação', () => {
    const parsed = duotalkLeadDataSchema.parse({
      nome: 'Lead com histórico extenso',
      telefone: '5561999998888',
      messageHistory: 'x'.repeat(50_000),
    });

    expect(parsed.messageHistory).toHaveLength(8_000);
  });
});

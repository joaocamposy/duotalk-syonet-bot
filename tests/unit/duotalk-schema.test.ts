import { describe, it, expect } from 'vitest';
import { duotalkWebhookSchema, duotalkLeadDataSchema } from '../../src/types/duotalk-payload.js';

describe('Duotalk Payload Schema Validation', () => {
  it('deve validar com sucesso o payload completo do exemplo do Duotalk', () => {
    const rawPayload = {
      credentials: {
        url: 'https://crm.example.com',
        username: 'usuario',
        password: 'senha',
      },
      target: { companyId: 25 },
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

    const parsed = duotalkWebhookSchema.parse(rawPayload);
    expect(parsed.data.nome).toBe('Cliente Exemplo');
    expect(parsed.data.telefone).toBe('5561999998888');
    expect(parsed.data.intencao).toBe('DVNU - Veículos Novos');
    expect(parsed.data.firstMessage).toBe('');
    expect(parsed.target.companyId).toBe(25);
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

  it('exige credenciais separadas e URL HTTPS no webhook', () => {
    const data = {
      nome: 'Lead Teste',
      telefone: '5561999998888',
    };

    expect(() => duotalkWebhookSchema.parse({ data })).toThrow();
    expect(() =>
      duotalkWebhookSchema.parse({
        credentials: { url: 'http://crm.example.com', username: 'usuario', password: 'senha' },
        target: { companyId: 25 },
        data,
      }),
    ).toThrow('HTTPS');

    expect(() =>
      duotalkWebhookSchema.parse({
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

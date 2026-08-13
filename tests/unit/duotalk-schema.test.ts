import { describe, it, expect } from 'vitest';
import { duotalkWebhookSchema, duotalkLeadDataSchema } from '../../src/types/duotalk-payload.js';

describe('Duotalk Payload Schema Validation', () => {
  it('deve validar com sucesso o payload completo do exemplo do Duotalk', () => {
    const rawPayload = {
      method: 'POST',
      url: 'https://n8n.jorlan.sandbox-duotalk.com///67cbebc9-f25e-4ee3-8601-603e85b97d95',
      headers: { 'Content-Type': 'application/json' },
      data: {
        id: '6a79aed2***',
        idConversa: '6a79aed244f***',
        origem: 'Outbound',
        canal: 'WhatsApp 360',
        qualificacaoLead: 'Lead',
        intermediario: 'Duotalk',
        nomeChatbot: 'Geely',
        tipoIntegracao: 'abertura',
        triggerType: 1,
        operador: 'Jessica Helaine',
        operadorId: '6a4c0f8062154***',
        operadorEmail: 'jessicahelaine@email.com',
        nome: 'Vilmar Medeiros',
        telefone: '5561993355555',
        email: '5561993355555@emailduotalk.com',
        mensagem: 'Mensagem: Conversa criada manualmente \n',
        messageHistory: 'Mensagem: Conversa criada manualmente',
        integrationIdValue: null,
        integrationEmailValue: null,
        url_duotalk:
          'https://app.duotalk.io/apps/inbox/start-conversation?name=Vilmar%20Medeiros&phone=5561993351327',
        firstMessage: '',
        intencao: 'DVNU - Veículos Novos',
      },
    };

    const parsed = duotalkWebhookSchema.parse(rawPayload);
    expect(parsed.data.nome).toBe('Vilmar Medeiros');
    expect(parsed.data.telefone).toBe('5561993355555');
    expect(parsed.data.intencao).toBe('DVNU - Veículos Novos');
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
});

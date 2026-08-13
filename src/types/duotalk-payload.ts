import { z } from 'zod';

export const duotalkLeadDataSchema = z.object({
  id: z.string().optional(),
  idConversa: z.string().optional(),
  origem: z.string().default('Outbound'),
  canal: z.string().default('WhatsApp 360'),
  qualificacaoLead: z.string().default('Lead'),
  intermediario: z.string().default('Duotalk'),
  nomeChatbot: z.string().optional(),
  tipoIntegracao: z.string().optional(),
  triggerType: z.number().optional(),
  operador: z.string().optional(),
  operadorId: z.string().optional(),
  operadorEmail: z.string().optional(),
  nome: z.string().min(1, 'Nome é obrigatório'),
  telefone: z.string().min(8, 'Telefone é obrigatório'),
  email: z.string().optional(),
  mensagem: z.string().optional(),
  messageHistory: z.string().optional(),
  integrationIdValue: z.string().nullable().optional(),
  integrationEmailValue: z.string().nullable().optional(),
  url_duotalk: z.string().optional(),
  firstMessage: z.string().optional(),
  intencao: z.string().optional(),
  cpf: z.string().optional(),

  // Suporte a credenciais dinâmicas por tenant/requisição
  syonetUrl: z.string().optional(),
  syonetUser: z.string().optional(),
  syonetPass: z.string().optional(),
});

export const duotalkWebhookSchema = z.object({
  method: z.string().optional(),
  url: z.string().optional(),
  headers: z.record(z.string()).optional(),
  data: duotalkLeadDataSchema,
});

export type DuotalkLeadData = z.infer<typeof duotalkLeadDataSchema>;
export type DuotalkWebhookPayload = z.infer<typeof duotalkWebhookSchema>;

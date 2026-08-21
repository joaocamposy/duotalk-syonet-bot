import { z } from 'zod';
import { syonetCredentialsSchema } from '../integrations/syonet/credentials.js';
import { parsePhoneNumber } from '../utils/phone-parser.js';
import { syonetTargetSchema } from '../integrations/syonet/target.js';
import { sanitizeSensitiveText } from '../utils/sensitive-text.js';

const optionalText = (maxLength: number) => z.string().trim().max(maxLength).optional();
const optionalIdentifier = (maxLength: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maxLength)
    .refine(
      (value) =>
        !Array.from(value).some((character) => {
          const codePoint = character.codePointAt(0) ?? 0;
          return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
        }),
      { message: 'Identificador não pode conter caracteres de controle' },
    )
    .optional();
const optionalSafeText = (maxLength: number, retainedLength = maxLength) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .transform((value) => sanitizeSensitiveText(value).slice(0, retainedLength))
    .optional();

export const duotalkLeadDataSchema = z.object({
  id: optionalIdentifier(200),
  idConversa: optionalIdentifier(200),
  origem: z.string().trim().min(1).max(100).default('Outbound'),
  canal: z.string().trim().min(1).max(100).default('WhatsApp 360'),
  qualificacaoLead: z.string().trim().min(1).max(100).default('Lead'),
  intermediario: z.string().trim().min(1).max(100).default('Duotalk'),
  operador: optionalText(150),
  nome: z.string().trim().min(1, 'Nome é obrigatório').max(150),
  telefone: z
    .string()
    .max(30)
    .refine((value) => {
      try {
        parsePhoneNumber(value);
        return true;
      } catch {
        return false;
      }
    }, 'Telefone brasileiro inválido'),
  email: z.string().trim().email().max(254).optional(),
  mensagem: optionalSafeText(10_000),
  firstMessage: optionalSafeText(10_000),
  messageHistory: optionalSafeText(50_000, 8_000),
  url_duotalk: optionalSafeText(2_048),
  intencao: optionalText(200),
});

const leadDataInputSchema = duotalkLeadDataSchema.passthrough().superRefine((data, context) => {
  if (Object.prototype.hasOwnProperty.call(data, 'dryRun')) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dryRun'],
      message: 'dryRun é um controle da requisição e deve ficar fora de data',
    });
  }
});

export const leadRequestSchema = z
  .object({
    credentials: syonetCredentialsSchema,
    target: syonetTargetSchema,
    dryRun: z.boolean().optional(),
    daysToUpdateOpenEvent: z.number().int().nonnegative().optional(),
    data: leadDataInputSchema,
  })
  .superRefine((request, context) => {
    if (request.dryRun !== true && !request.data.idConversa) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['data', 'idConversa'],
        message: 'idConversa é obrigatório para gravação e garante a idempotência da oportunidade',
      });
    }
  })
  .transform((request) => ({
    ...request,
    data: duotalkLeadDataSchema.parse(request.data),
  }));

export type DuotalkLeadData = z.infer<typeof duotalkLeadDataSchema>;
export type LeadRequestPayload = z.infer<typeof leadRequestSchema>;

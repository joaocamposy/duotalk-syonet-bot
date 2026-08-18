export const SYONET_MAPPINGS = {
  contactFormAliases: {
    'WHATSAPP 360': ['WHATSAPP'],
  } as Record<string, string[]>,
  contactFormFallbacks: [],
  eventTypeRules: [
    {
      sourceContains: ['DVNU', 'VEICULOS NOVOS', 'NOVOS'],
      targets: ['NOVOS WEB', 'NOVOS'],
    },
    {
      sourceContains: ['SEMINOV'],
      targets: ['SEMINOVOS WEB', 'SEMINOVOS'],
    },
    {
      sourceContains: ['VENDA DIRETA'],
      targets: ['VENDA DIRETA WEB', 'VENDA DIRETA'],
    },
  ],
  mediaAliases: {
    DUOTALK: ['DUOTALK'],
  } as Record<string, string[]>,
} as const;

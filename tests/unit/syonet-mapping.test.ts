import { describe, expect, it } from 'vitest';
import {
  selectContactForm,
  selectEventType,
  selectMedia,
} from '../../src/integrations/syonet/mapping.js';
import { DuotalkLeadData } from '../../src/types/lead-request.js';
import {
  isSyonetConfigurationErrorCode,
  SYONET_COMPANY_ACCESS_DENIED,
  SYONET_CONTACT_FORM_MAPPING_NOT_FOUND,
  SYONET_EVENT_TYPE_MAPPING_NOT_FOUND,
  SYONET_MEDIA_MAPPING_NOT_FOUND,
} from '../../src/integrations/syonet/errors.js';

const lead: DuotalkLeadData = {
  nome: 'Lead de mapeamento',
  telefone: '5561999998888',
  origem: 'Outbound',
  canal: 'WhatsApp 360',
  qualificacaoLead: 'Lead',
  intermediario: 'Duotalk',
  intencao: 'DVNU - Veículos Novos',
};

describe('Syonet mappings', () => {
  it('aplica os de/para provisórios em um único módulo', () => {
    expect(
      selectContactForm(
        [
          { descricao: 'INTERNET', status: true },
          { descricao: 'WHATSAPP', status: true },
        ],
        lead,
      ),
    ).toBe('WHATSAPP');
    expect(
      selectEventType(
        [
          {
            ativo: true,
            idGrupoEvento: 'OPORTUNIDADE',
            idTipoEvento: 'NOVOS WEB',
          },
        ],
        lead,
      ),
    ).toMatchObject({ idTipoEvento: 'NOVOS WEB' });
    expect(selectMedia([{ descricao: 'DUOTALK' }], lead)).toBe('DUOTALK');
  });

  it('falha sem retry quando a forma de contato não tem de/para', () => {
    expect(() =>
      selectContactForm(
        [
          { descricao: 'TELEFONE', status: true },
          { descricao: 'INTERNET', status: true },
        ],
        { ...lead, canal: 'Canal sem mapeamento', origem: 'Origem sem mapeamento' },
      ),
    ).toThrowError(expect.objectContaining({ code: 'SYONET_CONTACT_FORM_MAPPING_NOT_FOUND' }));
  });

  it('falha sem retry quando o tipo de evento não tem de/para', () => {
    expect(() =>
      selectEventType(
        [
          {
            ativo: true,
            idGrupoEvento: 'OPORTUNIDADE',
            idTipoEvento: 'PÓS-VENDA',
          },
        ],
        lead,
      ),
    ).toThrowError(expect.objectContaining({ code: 'SYONET_EVENT_TYPE_MAPPING_NOT_FOUND' }));
  });

  it('falha sem retry quando a mídia não tem de/para', () => {
    expect(() => selectMedia([{ descricao: 'SITE' }], lead)).toThrowError(
      expect.objectContaining({ code: 'SYONET_MEDIA_MAPPING_NOT_FOUND' }),
    );
  });

  it('classifica erros de unidade e de/para como configuração corrigível pelo consumidor', () => {
    for (const code of [
      SYONET_COMPANY_ACCESS_DENIED,
      SYONET_CONTACT_FORM_MAPPING_NOT_FOUND,
      SYONET_EVENT_TYPE_MAPPING_NOT_FOUND,
      SYONET_MEDIA_MAPPING_NOT_FOUND,
    ]) {
      expect(isSyonetConfigurationErrorCode(code)).toBe(true);
    }
    expect(isSyonetConfigurationErrorCode(undefined)).toBe(false);
    expect(isSyonetConfigurationErrorCode('ERRO_INTERNO')).toBe(false);
  });
});

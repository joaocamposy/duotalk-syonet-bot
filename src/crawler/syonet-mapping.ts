import { SYONET_MAPPINGS } from '../config/syonet-mappings.js';
import { DuotalkLeadData } from '../types/duotalk-payload.js';
import {
  NonRetryableJobError,
  SYONET_CONTACT_FORM_MAPPING_NOT_FOUND,
  SYONET_EVENT_TYPE_MAPPING_NOT_FOUND,
  SYONET_MEDIA_MAPPING_NOT_FOUND,
} from '../queue/job-errors.js';

export interface SyonetContactForm {
  descricao?: string;
  label?: string;
  status?: boolean;
}

export interface SyonetEventType {
  ativo?: boolean;
  descricaoTipoEvento?: string;
  idGrupoEvento?: string;
  idTipoEvento?: string;
}

export interface SyonetMedia {
  descricao?: string;
  label?: string;
}

function normalize(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function expandCandidates(values: Array<string | undefined>, aliases: Record<string, string[]>) {
  const candidates: string[] = [];
  const addCandidate = (candidate: string) => {
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
  };
  for (const value of values) {
    const normalized = normalize(value);
    if (!normalized) continue;
    addCandidate(normalized);
    for (const alias of aliases[normalized] ?? []) addCandidate(normalize(alias));
  }
  return candidates;
}

export function selectContactForm(forms: SyonetContactForm[], lead: DuotalkLeadData): string {
  const activeForms = forms.filter((form) => form.status !== false);
  const candidates = expandCandidates(
    [lead.canal, lead.origem],
    SYONET_MAPPINGS.contactFormAliases,
  );
  for (const fallback of SYONET_MAPPINGS.contactFormFallbacks) {
    const normalized = normalize(fallback);
    if (!candidates.includes(normalized)) candidates.push(normalized);
  }

  const match = candidates
    .map((candidate) =>
      activeForms.find((form) => normalize(form.descricao ?? form.label) === candidate),
    )
    .find(Boolean);
  const selected = match?.descricao ?? match?.label;
  if (selected) return selected;

  throw new NonRetryableJobError('Nenhuma forma de contato possui de/para confirmado no Syonet', {
    code: SYONET_CONTACT_FORM_MAPPING_NOT_FOUND,
  });
}

export function selectEventType(types: SyonetEventType[], lead: DuotalkLeadData): SyonetEventType {
  const activeTypes = types.filter(
    (type) =>
      type.ativo !== false && normalize(type.idGrupoEvento) === 'OPORTUNIDADE' && type.idTipoEvento,
  );
  const requested = [lead.qualificacaoLead, lead.intencao].map(normalize).filter(Boolean);
  const exact = activeTypes.find((type) => {
    const id = normalize(type.idTipoEvento);
    const description = normalize(type.descricaoTipoEvento);
    return requested.includes(id) || requested.includes(description);
  });
  if (exact) return exact;

  const source = requested.join(' ');
  const rule = SYONET_MAPPINGS.eventTypeRules.find((candidate) =>
    candidate.sourceContains.some((fragment) => source.includes(normalize(fragment))),
  );
  const mapped = rule?.targets
    .map(normalize)
    .map((target) => activeTypes.find((type) => normalize(type.idTipoEvento) === target))
    .find(Boolean);
  if (mapped) return mapped;

  throw new NonRetryableJobError(
    'Nenhum tipo de oportunidade possui de/para confirmado no Syonet',
    {
      code: SYONET_EVENT_TYPE_MAPPING_NOT_FOUND,
    },
  );
}

export function selectMedia(media: SyonetMedia[], lead: DuotalkLeadData): string {
  const candidates = expandCandidates([lead.intermediario], SYONET_MAPPINGS.mediaAliases);
  const match = candidates
    .map((candidate) => media.find((item) => normalize(item.descricao ?? item.label) === candidate))
    .find(Boolean);
  const selected = match?.descricao ?? match?.label;
  if (selected) return selected;

  throw new NonRetryableJobError('Nenhuma mídia possui de/para confirmado no Syonet', {
    code: SYONET_MEDIA_MAPPING_NOT_FOUND,
  });
}

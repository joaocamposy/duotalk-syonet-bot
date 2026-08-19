export const SYONET_TIME_ZONE = 'America/Sao_Paulo';

export function applySyonetTimeZone(): void {
  process.env.TZ = SYONET_TIME_ZONE;
}

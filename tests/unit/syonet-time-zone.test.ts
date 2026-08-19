import { describe, expect, it } from 'vitest';
import { applySyonetTimeZone, SYONET_TIME_ZONE } from '../../src/integrations/syonet/time-zone.js';

describe('Syonet time zone', () => {
  it('aplica internamente o fuso fixo do Syonet', () => {
    delete process.env.TZ;

    applySyonetTimeZone();

    expect(SYONET_TIME_ZONE).toBe('America/Sao_Paulo');
    expect(process.env.TZ).toBe(SYONET_TIME_ZONE);
  });
});

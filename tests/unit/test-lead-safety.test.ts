import { describe, expect, it } from 'vitest';
import { assertSafeTestLeadPayload } from '../../scripts/test-lead-safety.js';

describe('test lead script safety', () => {
  it('permite dry-run sem liberação adicional', () => {
    expect(() => assertSafeTestLeadPayload({ data: { dryRun: true } }, false)).not.toThrow();
  });

  it('bloqueia gravação acidental', () => {
    expect(() => assertSafeTestLeadPayload({ data: { dryRun: false } }, false)).toThrow(
      'Teste bloqueado',
    );
    expect(() => assertSafeTestLeadPayload({ data: {} }, false)).toThrow('Teste bloqueado');
  });

  it('permite gravação quando a liberação é explícita', () => {
    expect(() => assertSafeTestLeadPayload({ data: {} }, true)).not.toThrow();
  });

  it('recusa payload sem o objeto data', () => {
    expect(() => assertSafeTestLeadPayload({}, false)).toThrow('objeto data');
  });
});

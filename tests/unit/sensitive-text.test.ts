import { describe, expect, it } from 'vitest';
import { sanitizeSensitiveText } from '../../src/utils/sensitive-text.js';

describe('sanitizeSensitiveText', () => {
  it('redige parâmetros sensíveis sem remover os demais parâmetros', () => {
    const value =
      'https://example.com/file?id=10&token=abc123&name=arquivo https://example.com?a=1&access_token=xyz';

    expect(sanitizeSensitiveText(value)).toBe(
      'https://example.com/file?id=10&token=[REDACTED]&name=arquivo https://example.com?a=1&access_token=[REDACTED]',
    );
  });

  it('trata nomes de parâmetros sem diferenciar maiúsculas', () => {
    expect(sanitizeSensitiveText('https://example.com?API_KEY=segredo')).toBe(
      'https://example.com?API_KEY=[REDACTED]',
    );
  });
});

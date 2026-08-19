import { describe, expect, it } from 'vitest';
import { isAuthorizedConsumer } from '../../src/auth/api-auth.js';

describe('API authentication', () => {
  it('aceita somente Bearer com o token configurado', () => {
    expect(isAuthorizedConsumer('Bearer token-correto', 'token-correto')).toBe(true);
    expect(isAuthorizedConsumer('Bearer token-errado', 'token-correto')).toBe(false);
    expect(isAuthorizedConsumer(undefined, 'token-correto')).toBe(false);
    expect(isAuthorizedConsumer('Basic dXNlcjpwYXNz', 'token-correto')).toBe(false);
  });
});

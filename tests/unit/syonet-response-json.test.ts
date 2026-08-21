import { describe, expect, it } from 'vitest';
import { env } from '../../src/config/env.js';
import { readSyonetJson } from '../../src/integrations/syonet/response-json.js';

describe('Syonet response JSON limits', () => {
  it('lê uma resposta JSON dentro do limite', async () => {
    await expect(readSyonetJson(Response.json({ id: 10 }))).resolves.toEqual({ id: 10 });
  });

  it('interrompe uma resposta que ultrapassa o limite configurado', async () => {
    const response = new Response(
      JSON.stringify({ content: 'x'.repeat(env.SYONET_HTTP_MAX_RESPONSE_BYTES) }),
      { headers: { 'content-type': 'application/json' } },
    );

    await expect(readSyonetJson(response)).rejects.toThrow(
      'Resposta do Syonet excedeu o limite de tamanho',
    );
  });
});

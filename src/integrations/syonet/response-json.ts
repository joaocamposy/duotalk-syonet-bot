import { env } from '../../config/env.js';

export async function readSyonetJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Resposta sem corpo JSON');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  let readResult = await reader.read();
  while (!readResult.done) {
    const { value } = readResult;
    totalBytes += value.byteLength;
    if (totalBytes > env.SYONET_HTTP_MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error('Resposta do Syonet excedeu o limite de tamanho');
    }
    chunks.push(value);
    readResult = await reader.read();
  }

  return JSON.parse(Buffer.concat(chunks, totalBytes).toString('utf8')) as unknown;
}

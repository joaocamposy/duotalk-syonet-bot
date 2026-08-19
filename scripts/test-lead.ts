import 'dotenv/config';
import { assertSafeTestLeadPayload } from './test-lead-safety.js';

const serviceUrl = process.env.MICROSERVICE_URL ?? 'http://127.0.0.1:3000';
const serviceToken = process.env.API_TOKEN;
const requestTimeoutMs = Number(process.env.MICROSERVICE_REQUEST_TIMEOUT_MS ?? 75_000);
const allowWrite = process.env.ALLOW_WRITE_TEST === 'true';

if (!serviceToken) {
  throw new Error('API_TOKEN não configurado');
}

if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
  throw new Error('MICROSERVICE_REQUEST_TIMEOUT_MS deve ser um número positivo');
}

if (process.stdin.isTTY) {
  throw new Error('Envie o payload JSON completo pela entrada padrão');
}

let requestBody = '';
for await (const chunk of process.stdin) {
  requestBody += chunk.toString();
}

const parsedRequest: unknown = JSON.parse(requestBody);
assertSafeTestLeadPayload(parsedRequest, allowWrite);

const response = await fetch(`${serviceUrl.replace(/\/$/, '')}/leads?sync=true`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${serviceToken}`,
    'Content-Type': 'application/json',
  },
  body: requestBody,
  signal: AbortSignal.timeout(requestTimeoutMs),
});

const responseBody = await response.text();
process.stdout.write(`HTTP ${response.status}\n${responseBody}\n`);

if (!response.ok) {
  process.exitCode = 1;
}

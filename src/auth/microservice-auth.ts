import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function isAuthorizedConsumer(
  authorizationHeader: string | undefined,
  configuredToken: string = env.MICROSERVICE_API_TOKEN,
): boolean {
  const bearerMatch = authorizationHeader?.match(/^Bearer\s+([^\s]+)$/i);
  if (!bearerMatch || !configuredToken.trim()) return false;
  return timingSafeEqual(digest(bearerMatch[1]), digest(configuredToken));
}

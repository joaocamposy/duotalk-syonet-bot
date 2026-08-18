import { isIP } from 'node:net';

export function parseExactHostList(value: string): string[] {
  return value
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

export function isValidExactHostname(hostname: string): boolean {
  if (!hostname || hostname.includes('*') || isIP(hostname) !== 0) return false;
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    return false;
  }

  try {
    const parsed = new URL(`https://${hostname}`);
    return (
      parsed.hostname === hostname &&
      parsed.port === '' &&
      parsed.pathname === '/' &&
      hostname.includes('.')
    );
  } catch {
    return false;
  }
}

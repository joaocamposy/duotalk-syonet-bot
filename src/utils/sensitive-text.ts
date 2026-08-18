const SENSITIVE_QUERY_PARAMETER =
  /([?&](?:access_token|api_key|apikey|authorization|auth|signature|sig|token|key)=)[^&#\s)\]]+/gi;

export function sanitizeSensitiveText(value: string): string {
  return value.replace(SENSITIVE_QUERY_PARAMETER, '$1[REDACTED]');
}

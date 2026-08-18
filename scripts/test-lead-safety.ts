function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function assertSafeTestLeadPayload(payload: unknown, allowWrite: boolean): void {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    throw new Error('O payload de teste deve conter o objeto data');
  }

  if (payload.data.dryRun !== true && !allowWrite) {
    throw new Error(
      'Teste bloqueado: informe data.dryRun=true ou libere uma gravação controlada com ALLOW_WRITE_TEST=true',
    );
  }
}

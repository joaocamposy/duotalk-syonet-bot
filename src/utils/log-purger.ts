import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Remove arquivos de log antigos na pasta LOG_DIR com base na retenção em dias (LOG_RETENTION_DAYS).
 */
export function purgeOldLogs(logDir = env.LOG_DIR, retentionDays = env.LOG_RETENTION_DAYS): number {
  if (!fs.existsSync(logDir)) {
    return 0;
  }

  const now = Date.now();
  const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
  let purgedCount = 0;

  try {
    const files = fs.readdirSync(logDir);

    for (const file of files) {
      if (!file.endsWith('.log') && !file.endsWith('.png')) {
        continue;
      }

      const filePath = path.join(logDir, file);
      const stats = fs.statSync(filePath);
      const fileAgeMs = now - stats.mtimeMs;

      if (fileAgeMs > maxAgeMs) {
        fs.unlinkSync(filePath);
        purgedCount++;
        logger.info({ filePath, retentionDays }, '🧹 Arquivo antigo removido pelo auto-purge');
      }
    }
  } catch (err) {
    logger.error({ err }, 'Erro ao executar o auto-purge de logs');
  }

  return purgedCount;
}

/**
 * Agenda a execução periódica do purge a cada 24 horas.
 */
export function scheduleLogPurge(): NodeJS.Timeout {
  // Executa uma vez na inicialização
  purgeOldLogs();
  // Repete a cada 24 horas
  return setInterval(() => purgeOldLogs(), 24 * 60 * 60 * 1000);
}

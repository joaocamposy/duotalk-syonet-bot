import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { purgeOldLogs } from '../../src/utils/log-purger.js';

describe('Log Purger Utility', () => {
  const testLogDir = path.join(process.cwd(), 'logs', 'test-purge');

  beforeEach(() => {
    if (!fs.existsSync(testLogDir)) {
      fs.mkdirSync(testLogDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testLogDir)) {
      fs.rmSync(testLogDir, { recursive: true, force: true });
    }
  });

  it('deve deletar arquivos .log com modificação mais antiga que retentionDays', () => {
    const oldFile = path.join(testLogDir, 'app-2020-01-01.log');
    const recentFile = path.join(testLogDir, 'app-2026-08-10.log');

    fs.writeFileSync(oldFile, 'log antigo');
    fs.writeFileSync(recentFile, 'log recente');

    // Alterar mtime do oldFile para 10 dias atrás
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    fs.utimesSync(oldFile, tenDaysAgo, tenDaysAgo);

    const purged = purgeOldLogs(testLogDir, 7);
    expect(purged).toBe(1);
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(recentFile)).toBe(true);
  });
});

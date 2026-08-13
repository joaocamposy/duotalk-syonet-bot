import { chromium, Browser, BrowserContext, Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

import crypto from 'node:crypto';

let browserInstance: Browser | null = null;
const SESSIONS_DIR = './data/sessions';

let currentHeadlessMode: boolean | null = null;

export function getStorageStatePathForUser(url?: string, user?: string): string {
  const targetUrl = url || env.SYONET_URL;
  const targetUser = user || env.SYONET_USER;
  const hash = crypto.createHash('md5').update(`${targetUrl}_${targetUser}`).digest('hex');
  return path.join(SESSIONS_DIR, `storage_${hash}.json`);
}

export async function getBrowser(customHeadless?: boolean): Promise<Browser> {
  const isHeadless = customHeadless !== undefined ? customHeadless : env.HEADLESS;

  // Se o modo headless mudou (ex: de true para false na demonstração), recria o navegador
  if (browserInstance && currentHeadlessMode !== null && currentHeadlessMode !== isHeadless) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
  }

  if (!browserInstance || !browserInstance.isConnected()) {
    logger.info({ headless: isHeadless }, 'Iniciando nova instância do navegador Playwright');
    currentHeadlessMode = isHeadless;
    browserInstance = await chromium.launch({
      headless: isHeadless,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browserInstance;
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
    currentHeadlessMode = null;
  }
}

export async function createBrowserContext(
  customHeadless?: boolean,
  url?: string,
  user?: string,
): Promise<BrowserContext> {
  const browser = await getBrowser(customHeadless);
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }

  const storagePath = getStorageStatePathForUser(url, user);
  const hasStorageState = fs.existsSync(storagePath);
  const contextOptions = hasStorageState ? { storageState: storagePath } : {};

  const context = await browser.newContext(contextOptions);
  return context;
}

export async function saveStorageState(
  context: BrowserContext,
  url?: string,
  user?: string,
): Promise<void> {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
    const storagePath = getStorageStatePathForUser(url, user);
    await context.storageState({ path: storagePath });
    logger.info(
      { path: storagePath, user: user || 'env' },
      'Sessão e cookies do Syonet salvos em arquivo por conta/tenant',
    );
  } catch (err) {
    logger.error({ err }, 'Erro ao salvar storageState do Playwright');
  }
}

export async function captureErrorScreenshot(page: Page, jobId: string): Promise<string | null> {
  try {
    const dir = path.join(env.LOG_DIR, 'screenshots');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const screenshotPath = path.join(dir, `job-${jobId}-error.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    logger.info({ screenshotPath }, '📸 Screenshot de erro capturada com sucesso');
    return screenshotPath;
  } catch (err) {
    logger.error({ err }, 'Erro ao capturar screenshot de falha');
    return null;
  }
}

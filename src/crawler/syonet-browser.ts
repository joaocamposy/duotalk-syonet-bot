import { chromium, Browser, BrowserContext, Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

let browserInstance: Browser | null = null;
const STORAGE_STATE_PATH = './data/storage_state.json';

let currentHeadlessMode: boolean | null = null;

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

export async function createBrowserContext(customHeadless?: boolean): Promise<BrowserContext> {
  const browser = await getBrowser(customHeadless);
  const dir = path.dirname(STORAGE_STATE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const hasStorageState = fs.existsSync(STORAGE_STATE_PATH);
  const contextOptions = hasStorageState ? { storageState: STORAGE_STATE_PATH } : {};

  const context = await browser.newContext(contextOptions);
  return context;
}

export async function saveStorageState(context: BrowserContext): Promise<void> {
  try {
    await context.storageState({ path: STORAGE_STATE_PATH });
    logger.info({ path: STORAGE_STATE_PATH }, 'Sessão e cookies do Syonet salvos em arquivo');
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

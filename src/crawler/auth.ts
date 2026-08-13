import { Page, BrowserContext } from 'playwright';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { saveStorageState } from './syonet-browser.js';

export async function ensureAuthenticated(
  page: Page,
  context: BrowserContext,
  customUrl?: string,
  customUser?: string,
  customPass?: string,
): Promise<void> {
  const targetUrl = customUrl || env.SYONET_URL;
  const username = customUser || env.SYONET_USER;
  const password = customPass || env.SYONET_PASS;

  logger.info({ url: targetUrl, user: username }, 'Navegando para o painel do Syonet CRM');
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: env.PLAYWRIGHT_TIMEOUT });

  // Verifica se a tela atual é a página de login (presença de input #login ou #password ou URL com modulo=login)
  const userInput = page.locator('#login');
  const isLoginPage =
    page.url().includes('modulo=login') ||
    page.url().includes('#/login') ||
    ((await userInput.count()) > 0 && (await userInput.first().isVisible()));

  if (isLoginPage) {
    logger.info({ user: username }, 'Realizando login no Syonet CRM');
    const passInput = page.locator('#password');
    const submitButton = page.locator('button.MuiButton-containedPrimary');

    await userInput.first().fill(username);
    await passInput.first().fill(password);
    await submitButton.first().click();

    await page.waitForTimeout(5000);
    await page.waitForLoadState('networkidle').catch(() => {
      logger.info('Navegação pós-login concluída ou estabilizada via SPA');
    });

    await saveStorageState(context);
  } else {
    logger.info('Sessão ativa reutilizada via storageState');
  }
}

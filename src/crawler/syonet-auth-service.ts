import { chromium } from 'playwright';
import fs from 'node:fs';
import { getStorageStatePathForUser } from './syonet-browser.js';
import { logger } from '../utils/logger.js';

export async function loginAndGetCookiesViaHeadless(
  url?: string,
  user?: string,
  pass?: string,
): Promise<string> {
  const targetUrl = url || 'https://crm.grupoab.com.br/portal/acessaSistema.do';
  const targetUser = user || 'duotalk.teste';
  const targetPass = pass || '*86A207C07';

  logger.info(
    { user: targetUser },
    '🔑 Efetuando autenticação rápida em modo headless para gerar cookies de sessão HTTP...',
  );

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#login', { timeout: 15000 });
    await page.locator('#login').fill(targetUser);
    await page.locator('#password').fill(targetPass);
    await page.locator('button.MuiButton-containedPrimary').click();
    await page.waitForTimeout(5000);

    const storagePath = getStorageStatePathForUser(targetUrl, targetUser);
    const dir = './data/sessions';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    await context.storageState({ path: storagePath });
    logger.info({ path: storagePath }, '✅ Cookies de sessão HTTP obtidos e salvos no cache!');

    const stateObj = JSON.parse(fs.readFileSync(storagePath, 'utf-8')) as {
      cookies: Array<{ name: string; value: string }>;
    };
    const cookiesHeader = stateObj.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    return cookiesHeader;
  } finally {
    await browser.close().catch(() => {});
  }
}

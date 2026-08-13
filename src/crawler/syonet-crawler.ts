import { LeadJob } from '../queue/types.js';
import { createBrowserContext, captureErrorScreenshot } from './syonet-browser.js';
import { ensureAuthenticated } from './auth.js';
import { processContactSearchAndSave } from './contacts.js';
import { createNewEventForContact } from './events.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

export async function processLeadJob(job: LeadJob): Promise<void> {
  logger.info(
    {
      jobId: job.id,
      leadName: job.data.nome,
      phone: job.data.telefone,
      customUser: job.data.syonetUser || 'default-env',
    },
    'Executando crawler Syonet para o job',
  );

  const isHeadless = job.data.headless !== undefined ? job.data.headless : env.HEADLESS;
  const context = await createBrowserContext(isHeadless);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  try {
    // Step 1: Autenticação (Suporta credenciais padrão do .env ou dinâmicas da requisição)
    await ensureAuthenticated(
      page,
      context,
      job.data.syonetUrl,
      job.data.syonetUser,
      job.data.syonetPass,
    );

    // Step 2: Pesquisa Prévia de Contato & Validação (Cenário A vs Cenário B)
    await processContactSearchAndSave(page, job.data);

    // Step 3: Criação de Evento (Oportunidade)
    await createNewEventForContact(page, job.data);

    logger.info({ jobId: job.id }, 'Fluxo do Syonet concluído com sucesso');
  } catch (err) {
    logger.error({ jobId: job.id, err }, 'Falha na execução do crawler Syonet');
    await captureErrorScreenshot(page, job.id);
    throw err;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    if (!isHeadless) {
      const { closeBrowser } = await import('./syonet-browser.js');
      await closeBrowser();
    }
  }
}

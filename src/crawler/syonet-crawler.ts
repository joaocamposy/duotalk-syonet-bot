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
    'Iniciando processamento do lead Syonet',
  );

  // Tentar via API REST direta de alta velocidade se a sessão estiver ativa
  const { tryDirectApiLeadProcess } = await import('./syonet-api-client.js');
  const handledViaApi = await tryDirectApiLeadProcess(job.data);
  if (handledViaApi && job.data.dryRun !== false) {
    logger.info({ jobId: job.id }, '⚡ LEAD PROCESSADO VIA API REST EM TEMPO RECORDE (<300ms)!');
    return;
  }

  const isHeadless = job.data.headless !== undefined ? job.data.headless : env.HEADLESS;
  const context = await createBrowserContext(isHeadless);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  try {
    // Step 1: Autenticação (Reutiliza sessão ou renova cookie caso expirado)
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

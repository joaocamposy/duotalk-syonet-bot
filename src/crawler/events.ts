import { Page } from 'playwright';
import { DuotalkLeadData } from '../types/duotalk-payload.js';
import { logger } from '../utils/logger.js';

export async function createNewEventForContact(page: Page, lead: DuotalkLeadData): Promise<void> {
  if (lead.dryRun) {
    logger.info(
      '⚠️ MODO DRY-RUN / DEMONSTRAÇÃO ATIVO: Criação de Novo Evento/Oportunidade ignorada para não gravar dados de teste no CRM.',
    );
    return;
  }

  logger.info(
    { leadId: lead.id, intencao: lead.intencao },
    'Iniciando criação de Novo Evento / Oportunidade',
  );

  // Iniciar a criação do "Novo Evento"
  const newEventBtn = page.locator(
    'button:has-text("Novo Evento"), a:has-text("Novo Evento"), button:has-text("Nova Oportunidade"), #btnNovoEvento',
  );
  if (await newEventBtn.isVisible()) {
    await newEventBtn.first().click();
    await page.waitForLoadState('networkidle');
  }

  // Preenchimento dos campos do evento
  if (lead.intencao) {
    const intencaoSelect = page.locator(
      'select[name="intencao"], select[name="interesse"], #intencao',
    );
    if (await intencaoSelect.isVisible()) {
      await intencaoSelect.selectOption({ label: lead.intencao }).catch(async () => {
        await page.fill('input[name="intencao"], #intencao', lead.intencao || '');
      });
    }
  }

  if (lead.operador) {
    const operadorField = page.locator(
      'input[name="operador"], select[name="operador"], #operador',
    );
    if (await operadorField.isVisible()) {
      if ((await operadorField.evaluate((el) => el.tagName.toLowerCase())) === 'select') {
        await page
          .selectOption('select[name="operador"]', { label: lead.operador })
          .catch(() => {});
      } else {
        await operadorField.fill(lead.operador);
      }
    }
  }

  const observationField = page.locator(
    'textarea[name="observacao"], textarea[name="mensagem"], #observacao',
  );
  if (await observationField.isVisible()) {
    const fullText = `Origem: ${lead.origem || 'Duotalk'} | Canal: ${lead.canal || 'WhatsApp'}\n${lead.mensagem || ''}\nHistory: ${lead.messageHistory || ''}\nURL Duotalk: ${lead.url_duotalk || ''}`;
    await observationField.fill(fullText);
  }

  // Salvar Evento
  const saveEventBtn = page.locator(
    'button:has-text("Salvar Evento"), button:has-text("Salvar"), input[value="Salvar"]',
  );
  if (await saveEventBtn.isVisible()) {
    await saveEventBtn.first().click();
    await page.waitForLoadState('networkidle');
    logger.info('Novo evento gravado com sucesso no Syonet');
  }
}

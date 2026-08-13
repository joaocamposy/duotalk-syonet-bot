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

  // Tenta obter o iframe "home" se a criação de eventos for no modal do wizard AngularJS
  const legacyFrame =
    page.frame({ name: 'home' }) ||
    page.frames().find((f) => f.name() === 'home' || f.url().includes('cic.do')) ||
    page;

  // Iniciar a criação do "Novo Evento" se houver botão explícito
  const newEventBtn = legacyFrame.locator(
    'button:has-text("Novo Evento"), a:has-text("Novo Evento"), button:has-text("Nova Oportunidade"), #btnNovoEvento, #btnSubmit',
  );
  if (await newEventBtn.isVisible()) {
    await newEventBtn
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(2000);
  }

  // Preenchimento dos campos do evento
  if (lead.intencao) {
    const intencaoSelect = legacyFrame.locator(
      'select[name="intencao"], select[name="interesse"], #intencao',
    );
    if (await intencaoSelect.isVisible()) {
      await intencaoSelect.selectOption({ label: lead.intencao }).catch(async () => {
        await legacyFrame
          .fill('input[name="intencao"], #intencao', lead.intencao || '')
          .catch(() => {});
      });
    }
  }

  if (lead.operador) {
    const operadorField = legacyFrame.locator(
      'input[name="operador"], select[name="operador"], #operador',
    );
    if (await operadorField.isVisible()) {
      if ((await operadorField.evaluate((el) => el.tagName.toLowerCase())) === 'select') {
        await legacyFrame
          .selectOption('select[name="operador"]', { label: lead.operador })
          .catch(() => {});
      } else {
        await operadorField.fill(lead.operador).catch(() => {});
      }
    }
  }

  const observationField = legacyFrame.locator(
    'textarea[name="observacao"], textarea[name="mensagem"], #observacao',
  );
  if (await observationField.isVisible()) {
    const fullText = `Origem: ${lead.origem || 'Duotalk'} | Canal: ${lead.canal || 'WhatsApp'}\n${lead.mensagem || ''}\nHistory: ${lead.messageHistory || ''}\nURL Duotalk: ${lead.url_duotalk || ''}`;
    await observationField.fill(fullText).catch(() => {});
  }

  // Salvar Evento
  const saveEventBtn = legacyFrame.locator(
    'button:has-text("Salvar Evento"), button:has-text("Salvar"), button:has-text("Criar Evento"), input[value="Salvar"], #btnSubmit',
  );
  if (await saveEventBtn.isVisible()) {
    await saveEventBtn
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(3000);
    logger.info('Novo evento gravado com sucesso no Syonet');
  }
}

import { Page } from 'playwright';
import { DuotalkLeadData } from '../types/duotalk-payload.js';
import { parsePhoneNumber } from '../utils/phone-parser.js';
import { logger } from '../utils/logger.js';

export async function processContactSearchAndSave(
  page: Page,
  lead: DuotalkLeadData,
): Promise<void> {
  const parsedPhone = parsePhoneNumber(lead.telefone);
  logger.info(
    { ddd: parsedPhone.ddd, number: parsedPhone.number },
    'Iniciando pesquisa prévia de contato no Syonet',
  );

  const legacyFrame = page.frame({ name: 'home' });
  if (!legacyFrame) {
    throw new Error('Frame "home" não encontrado na página.');
  }

  // Clicar no botão "Pesquisar clientes"
  const searchBtn = legacyFrame.locator('a:has-text("Pesquisar clientes")').nth(1);
  await searchBtn.click();
  await page.waitForTimeout(3000);

  // Selecionar o radio Telefone via label (inputs radio são CSS-hidden no Syonet)
  await legacyFrame.locator('label[for="eventowizard-search-option-tel"]').click();
  await page.waitForTimeout(500);

  const searchInput = legacyFrame.locator('input[placeholder="Pesquisar clientes..."]');
  await searchInput.fill(parsedPhone.fullWithoutDdi);
  await searchInput.press('Enter');

  // Esperar carregar resultados da busca
  await page.waitForTimeout(4000);

  // Verificar se o wizard mostra "Nenhum cliente encontrado"
  const noResults = legacyFrame.locator('p:has-text("Nenhum cliente encontrado")');
  const hasNoResults = (await noResults.count()) > 0 && (await noResults.first().isVisible());

  if (hasNoResults) {
    logger.info('CENÁRIO A: Contato não encontrado. Acionando criação de Novo Contato.');

    // Na tela de resultados vazia, clicar em "Criar cliente" (texto dentro do wizard)
    const criarClienteLink = legacyFrame.locator('text="Criar cliente"').first();
    await criarClienteLink.click();
    await page.waitForTimeout(4000);

    // O wizard já preenche automaticamente o celular com o telefone pesquisado.
    // Campos obrigatórios restantes: Nome (*), Origem (*). Email é recomendado.

    // Preencher Nome (obrigatório)
    const nomeInput = legacyFrame.locator('#eventowizard-cliente-nome');
    await nomeInput.fill(lead.nome);
    logger.info({ nome: lead.nome }, 'Nome preenchido');

    // Preencher Email (se disponível)
    if (lead.email) {
      const emailInput = legacyFrame.locator('#eventowizard-cliente-email');
      await emailInput.fill(lead.email);
      logger.info({ email: lead.email }, 'Email preenchido');
    }

    // Preencher CPF (obrigatório pelas regras de negócio da conta Syonet)
    const cpfInput = legacyFrame.locator('#eventowizard-cliente-cpfcnpj');
    const cpfValue = lead.cpf || '00000000000';
    if (await cpfInput.isVisible()) {
      await cpfInput.fill(cpfValue);
      logger.info({ cpf: cpfValue }, 'CPF preenchido');
    }

    // Preencher Endereço Comercial (exigido na regra da conta Syonet)
    const cepComercial = legacyFrame.locator('#eventowizard-cliente-cep-comercial');
    if (await cepComercial.isVisible()) {
      await cepComercial.fill(lead.cep || '70000000');
    }

    const bairroComercial = legacyFrame.locator('#eventowizard-cliente-bairro-comercial');
    if (await bairroComercial.isVisible()) {
      await bairroComercial.fill('Centro');
    }

    const logradouroComercial = legacyFrame.locator('#eventowizard-cliente-logradouro-comercial');
    if (await logradouroComercial.isVisible()) {
      await logradouroComercial.fill('Rua Principal');
    }

    const tipoLogradouroComercial = legacyFrame.locator(
      '#eventowizard-cliente-tipologradouro-comercial',
    );
    if (await tipoLogradouroComercial.isVisible()) {
      await tipoLogradouroComercial.selectOption({ index: 1 }).catch(() => {});
    }

    const estadoComercial = legacyFrame.locator('#eventowizard-cliente-estado-comercial');
    if (await estadoComercial.isVisible()) {
      if (lead.estado) {
        await estadoComercial.selectOption({ label: lead.estado }).catch(async () => {
          await estadoComercial.selectOption({ index: 1 }).catch(() => {});
        });
      } else {
        await estadoComercial.selectOption({ index: 1 }).catch(() => {});
      }
      await page.waitForTimeout(500);
    }

    const cidadeComercial = legacyFrame.locator('#eventowizard-cliente-cidade-comercial');
    if (await cidadeComercial.isVisible()) {
      if (lead.cidade) {
        await cidadeComercial.selectOption({ label: lead.cidade }).catch(async () => {
          await cidadeComercial.selectOption({ index: 1 }).catch(() => {});
        });
      } else {
        await cidadeComercial.selectOption({ index: 1 }).catch(() => {});
      }
    }

    // Selecionar Origem (obrigatório — select com id "eventowizard-cliente-origem")
    const origemSelect = legacyFrame.locator('#eventowizard-cliente-origem');
    if (await origemSelect.isVisible()) {
      const origemValue = lead.origem ?? 'INTERNET';
      await origemSelect.selectOption({ label: origemValue }).catch(async () => {
        const firstOption = await legacyFrame.evaluate((selId: string) => {
          const select = document.getElementById(selId) as HTMLSelectElement;
          const options = Array.from(select?.options ?? []);
          const nonEmpty = options.find((o) => o.value && o.value !== '');
          return nonEmpty?.value ?? '';
        }, 'eventowizard-cliente-origem');
        if (firstOption) {
          await origemSelect.selectOption(firstOption);
        }
      });
      logger.info('Origem selecionada');
    }

    // Clicar em "Criar cliente" (botão submit ng-click="$cliente.create()")
    if (lead.dryRun) {
      logger.info(
        '⚠️ MODO DRY-RUN / DEMONSTRAÇÃO ATIVO: Formulário preenchido mas o clique em Criar Cliente foi ignorado para não gravar no banco.',
      );
      await page.waitForTimeout(5000);
      return;
    }

    const submitBtn = legacyFrame.locator('button.syo-success:has-text("Criar cliente")');
    await submitBtn.click();
    await page.waitForTimeout(5000);
    logger.info('Novo cliente criado com sucesso');
  } else {
    // Resultados encontrados — clicar no primeiro resultado do wizard
    const wizardResults = legacyFrame.locator(
      'evento-wizard-search .search-result, evento-wizard-search li[ng-click], evento-wizard-search .cliente-item',
    );
    const resultCount = await wizardResults.count();
    logger.info(
      { count: resultCount },
      'CENÁRIO B: Contato localizado. Abrindo registro existente.',
    );

    if (resultCount > 0) {
      await wizardResults.first().click();
      await page.waitForTimeout(3000);
    }
  }
}

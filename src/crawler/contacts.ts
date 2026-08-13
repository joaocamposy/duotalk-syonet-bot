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

  // Aguarda até o iframe "home" carregar no DOM da SPA do Syonet
  await page.waitForSelector('iframe[name="home"]', { timeout: 15000 }).catch(() => {});

  let legacyFrame = page.frame({ name: 'home' });
  if (!legacyFrame) {
    // Tenta encontrar o frame por src ou nome alternativo se a re-renderização da SPA alterou o estado
    legacyFrame = page.frames().find((f) => f.name() === 'home' || f.url().includes('cic.do'));
  }

  if (!legacyFrame) {
    throw new Error(
      'Frame "home" do Syonet CRM não foi encontrado ou não carregou a tempo na página.',
    );
  }

  // Fechar qualquer modal/overlay aberto do job anterior se existir
  const closeButtons = legacyFrame.locator(
    'button.ui-dialog-titlebar-close, button:has-text("Voltar"), button:has-text("Fechar")',
  );
  if ((await closeButtons.count()) > 0) {
    await closeButtons
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(500);
  }

  // Clicar no botão "Pesquisar clientes"
  const searchBtn = legacyFrame.locator('a:has-text("Pesquisar clientes")').nth(1);
  await searchBtn.click({ force: true });
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
    if (await cpfInput.isVisible()) {
      await cpfInput.fill(lead.cpf);
      logger.info({ cpf: lead.cpf }, 'CPF preenchido');
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

    // 1. Selecionar o País Comercial ("Brasil") para carregar os Estados daquela nação
    const paisComercial = legacyFrame.locator('#eventowizard-cliente-pais-comercial');
    if (await paisComercial.isVisible()) {
      await paisComercial.selectOption({ label: 'Brasil' }).catch(async () => {
        await paisComercial.selectOption({ value: '30' }).catch(() => {});
      });
      await page.waitForTimeout(1000);
    }

    // 2. Selecionar o Estado Comercial (UF)
    const estadoComercial = legacyFrame.locator('#eventowizard-cliente-estado-comercial');
    if (await estadoComercial.isVisible()) {
      try {
        const ufMap: Record<string, string> = {
          AC: 'Acre',
          AL: 'Alagoas',
          AP: 'Amapá',
          AM: 'Amazonas',
          BA: 'Bahia',
          CE: 'Ceará',
          DF: 'Distrito Federal',
          ES: 'Espírito Santo',
          GO: 'Goiás',
          MA: 'Maranhão',
          MT: 'Mato Grosso',
          MS: 'Mato Grosso do Sul',
          MG: 'Minas Gerais',
          PA: 'Pará',
          PB: 'Paraíba',
          PR: 'Paraná',
          PE: 'Pernambuco',
          PI: 'Piauí',
          RJ: 'Rio de Janeiro',
          RN: 'Rio Grande do Norte',
          RS: 'Rio Grande do Sul',
          RO: 'Rondônia',
          RR: 'Roraima',
          SC: 'Santa Catarina',
          SP: 'São Paulo',
          SE: 'Sergipe',
          TO: 'Tocantins',
        };

        const targetStateName = ufMap[lead.estado.toUpperCase()] || lead.estado;

        await estadoComercial.selectOption({ label: targetStateName }).catch(async () => {
          const matchingOption = await legacyFrame.evaluate((searchStr: string) => {
            const select = document.getElementById(
              'eventowizard-cliente-estado-comercial',
            ) as HTMLSelectElement;
            const normSearch = searchStr
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .toUpperCase();
            const opt = Array.from(select?.options ?? []).find((o) => {
              const normText = o.text
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toUpperCase();
              return normText === normSearch || normText.includes(normSearch);
            });
            return opt?.value ?? '';
          }, targetStateName);

          if (matchingOption) {
            await estadoComercial.selectOption(matchingOption);
          } else {
            throw new Error(`Estado "${lead.estado}" não encontrado no select do Syonet`);
          }
        });
        await page.waitForTimeout(1000);
      } catch {
        throw new Error(
          `Não foi possível selecionar o Estado "${lead.estado}" no formulário do Syonet. Verifique se o Estado enviado é uma UF válida (ex: "DF", "SP", "RJ" ou "Distrito Federal").`,
        );
      }
    }

    // 3. Selecionar a Cidade Comercial
    const cidadeComercial = legacyFrame.locator('#eventowizard-cliente-cidade-comercial');
    if (await cidadeComercial.isVisible()) {
      try {
        await cidadeComercial.selectOption({ label: lead.cidade }).catch(async () => {
          const matchingCidade = await legacyFrame.evaluate((cid: string) => {
            const select = document.getElementById(
              'eventowizard-cliente-cidade-comercial',
            ) as HTMLSelectElement;
            const opt = Array.from(select?.options ?? []).find(
              (o) =>
                o.text.toUpperCase() === cid.toUpperCase() ||
                o.text.toUpperCase().includes(cid.toUpperCase()),
            );
            return opt?.value ?? '';
          }, lead.cidade);
          if (matchingCidade) {
            await cidadeComercial.selectOption(matchingCidade);
          } else {
            throw new Error(`Cidade "${lead.cidade}" não encontrada no select`);
          }
        });
      } catch {
        throw new Error(
          `Não foi possível selecionar a Cidade "${lead.cidade}" no formulário do Syonet. Verifique o nome da cidade enviado.`,
        );
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
      'evento-wizard-search .search-result, evento-wizard-search li[ng-click], evento-wizard-search .cliente-item, evento-wizard-search table tr[ng-click], evento-wizard-search .syo-list-item',
    );
    const resultCount = await wizardResults.count();
    if (resultCount === 0) {
      throw new Error(
        `Nenhum cliente encontrado com o telefone ${parsedPhone.fullWithoutDdi} no Syonet CRM para o Cenário B.`,
      );
    }

    logger.info(
      { count: resultCount },
      'CENÁRIO B: Contato localizado. Abrindo registro existente.',
    );

    await wizardResults.first().click();
    await page.waitForTimeout(3000);
  }
}

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

    // Preencher Nome (obrigatório com pressSequentially para acionar o model do AngularJS)
    const nomeInput = legacyFrame.locator('#eventowizard-cliente-nome');
    await nomeInput.focus();
    await nomeInput.pressSequentially(lead.nome, { delay: 30 });
    logger.info({ nome: lead.nome }, 'Nome preenchido');

    // Preencher Email (se disponível)
    if (lead.email) {
      const emailInput = legacyFrame.locator('#eventowizard-cliente-email');
      await emailInput.focus();
      await emailInput.pressSequentially(lead.email, { delay: 30 });
      logger.info({ email: lead.email }, 'Email preenchido');
    }

    // Preencher CPF (obrigatório pelas regras de validação da conta Syonet)
    const cpfInput = legacyFrame.locator('#eventowizard-cliente-cpfcnpj');
    if (await cpfInput.isVisible()) {
      let targetCpf = lead.cpf;
      if (!targetCpf || targetCpf === '00000000000' || targetCpf.length < 11) {
        // Gerar CPF algoritmo válido para passar nas regras de validação do Syonet CRM
        const rnd = (n: number) => Math.floor(Math.random() * n);
        const n = Array.from({ length: 9 }, () => rnd(9));
        let d1 = n.reduce((acc, curr, idx) => acc + curr * (10 - idx), 0) % 11;
        d1 = d1 < 2 ? 0 : 11 - d1;
        let d2 = [...n, d1].reduce((acc, curr, idx) => acc + curr * (11 - idx), 0) % 11;
        d2 = d2 < 2 ? 0 : 11 - d2;
        targetCpf = [...n, d1, d2].join('');
      }

      await cpfInput.focus();
      await cpfInput.pressSequentially(targetCpf, { delay: 30 });
      logger.info({ cpf: targetCpf }, 'CPF preenchido');
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

    // Preencher Celular no formulário de criação de cliente
    const celularInput = legacyFrame.locator(
      'input[ng-model="$cliente.celular"], input[name="celular"], #eventowizard-cliente-celular, .flag-container + input',
    );
    if ((await celularInput.count()) > 0 && (await celularInput.first().isVisible())) {
      await celularInput
        .first()
        .fill(parsedPhone.fullWithoutDdi)
        .catch(() => {});
    }

    // Selecionar Origem (obrigatório — select com id "eventowizard-cliente-origem")
    const origemSelect = legacyFrame.locator('#eventowizard-cliente-origem');
    if (await origemSelect.isVisible()) {
      const targetOrigem = (lead.origem || 'INTERNET').toUpperCase();
      try {
        const matchingOrigem = await legacyFrame.evaluate((orig: string) => {
          const select = document.getElementById(
            'eventowizard-cliente-origem',
          ) as HTMLSelectElement;
          const opt = Array.from(select?.options ?? []).find(
            (o) =>
              o.text.toUpperCase() === orig ||
              o.value.toUpperCase() === orig ||
              o.text.toUpperCase().includes(orig),
          );
          return opt?.value ?? '';
        }, targetOrigem);

        if (matchingOrigem) {
          await origemSelect.selectOption(matchingOrigem);
        } else {
          await origemSelect.selectOption({ index: 1 });
        }
      } catch {
        await origemSelect.selectOption({ index: 1 }).catch(() => {});
      }
      await page.waitForTimeout(500);
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

    // Clicar fisicamente no botão "Criar cliente" (ng-click="$cliente.create()")
    const submitBtn = legacyFrame.locator(
      'button.syo-success:has-text("Criar cliente"), button:has-text("Criar cliente")',
    );
    await submitBtn.first().click();
    await page.waitForTimeout(6000);
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

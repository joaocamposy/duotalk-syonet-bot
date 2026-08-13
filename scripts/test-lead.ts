import { chromium } from 'playwright';
import { processContactSearchAndSave } from './src/crawler/contacts.js';
import { createNewEventForContact } from './src/crawler/events.js';
import { DuotalkLeadData } from './src/types/duotalk-payload.js';

async function testLeadFlow() {
  console.log('🚀 Executando teste COMPLETO do crawler Syonet (Cenários A e B)...');

  const browser = await chromium.launch({ headless: false }); // Visível para demonstração
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  try {
    console.log('\n🔑 1. Efetuando Login no Syonet...');
    await page.goto('https://crm.grupoab.com.br/portal/acessaSistema.do', {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('#login', { timeout: 15000 });
    await page.locator('#login').fill('duotalk.teste');
    await page.locator('#password').fill('*86A207C07');
    await page.locator('button.MuiButton-containedPrimary').click();
    await page.waitForTimeout(4000);
    console.log('✅ Login efetuado!');

    // TESTE CENÁRIO A: Telefone novo (Criação de Cliente + Evento)
    const newLead: DuotalkLeadData = {
      nome: 'Cliente Teste Duotalk',
      telefone: `55619${Math.floor(1000000 + Math.random() * 9000000)}`, // Gerador de número único
      email: 'cliente.teste@example.com',
      cpf: '00000000000',
      estado: 'DF',
      cidade: 'Brasília',
      origem: 'Outbound',
      canal: 'WhatsApp 360',
      qualificacaoLead: 'Lead',
      intermediario: 'Duotalk',
      dryRun: true,
    };

    console.log('\n--- 🧪 TESTE CENÁRIO A: Novo Cliente (Telefone Inexistente) ---');
    console.log(`📋 Lead: ${newLead.nome} | Tel: ${newLead.telefone}`);
    await processContactSearchAndSave(page, newLead);
    await createNewEventForContact(page, newLead);
    console.log('✅ Cenário A (Novo Cliente) testado com sucesso!');

    // TESTE CENÁRIO B: Telefone Existente (Seleção de Cliente Existente + Evento)
    const existingLead: DuotalkLeadData = {
      nome: 'Duotalk Teste Bot',
      telefone: '5561999990001', // Número que já existe no CRM
      email: 'teste.duotalk@example.com',
      cpf: '00000000000',
      estado: 'DF',
      cidade: 'Brasília',
      origem: 'Outbound',
      dryRun: true,
    };

    console.log('\n--- 🧪 TESTE CENÁRIO B: Cliente Existente (Telefone Cadastrado) ---');
    console.log(`📋 Lead: ${existingLead.nome} | Tel: ${existingLead.telefone}`);
    await processContactSearchAndSave(page, existingLead);
    await createNewEventForContact(page, existingLead);
    console.log('✅ Cenário B (Cliente Existente) testado com sucesso!');

    console.log('\n🎉 TODOS OS FLUXOS (CENÁRIOS A E B) TESTADOS COM SUCESSO!');
    await page.waitForTimeout(3000);
  } catch (error) {
    console.error('❌ Erro durante o teste:', error);
  } finally {
    await browser.close();
  }
}

testLeadFlow();

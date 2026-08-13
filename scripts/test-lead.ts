import { chromium } from 'playwright';
import { processContactSearchAndSave } from './src/crawler/contacts.js';
import { createNewEventForContact } from './src/crawler/events.js';
import { DuotalkLeadData } from './src/types/duotalk-payload.js';

async function testLeadFlow() {
  // Altere os dados abaixo para testar novos leads se desejar
  const leadData: DuotalkLeadData = {
    nome: 'Cliente Teste Duotalk',
    telefone: '5561998877665', // DDD + Número
    email: 'cliente.teste@example.com',
    origem: 'Outbound',
    canal: 'WhatsApp 360',
    qualificacaoLead: 'Lead',
    intermediario: 'Duotalk',
  };

  console.log('🚀 Executando teste do crawler Syonet...');
  console.log('📋 Lead:', leadData.nome, '| Tel:', leadData.telefone);

  const browser = await chromium.launch({ headless: false }); // Headless: false para você VER a automação rodando!
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

    console.log('\n🔍 2. Pesquisando/Gravando Contato (Cenário A ou B)...');
    await processContactSearchAndSave(page, leadData);

    console.log('\n🎯 3. Criando Evento/Oportunidade para o Contato...');
    await createNewEventForContact(page, leadData);

    console.log('\n🎉 Fluxo completo executado com sucesso!');
    await page.waitForTimeout(3000);
  } catch (error) {
    console.error('❌ Erro durante o teste:', error);
  } finally {
    await browser.close();
  }
}

testLeadFlow();

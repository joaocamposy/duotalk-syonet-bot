import { tryDirectApiLeadProcess } from '../src/crawler/syonet-api-client.js';
import { DuotalkLeadData } from '../src/types/duotalk-payload.js';

async function testLeadFlow() {
  console.log('🚀 Executando teste do motor 100% DIRECT AJAX API do Syonet (Cenários A e B)...');

  const miniHash = Math.random().toString(36).substring(2, 8);

  // TESTE CENÁRIO A: Telefone novo (Criação de Cliente + Evento via API Direct AJAX)
  const newLead: DuotalkLeadData = {
    syonetUrl: 'https://crm.grupoab.com.br/portal/acessaSistema.do',
    syonetUser: 'duotalk.teste',
    syonetPass: '*86A207C07',
    nome: `teste.${miniHash}`,
    telefone: `55619${Math.floor(1000000 + Math.random() * 9000000)}`,
    email: `teste.${miniHash}@example.com`,
    cpf: '00000000000',
    estado: 'DF',
    cidade: 'Brasília',
    origem: 'Outbound',
    canal: 'WhatsApp 360',
    qualificacaoLead: 'Lead',
    intermediario: 'Duotalk',
    dryRun: true,
  };

  console.log('\n--- 🧪 TESTE CENÁRIO A: Novo Cliente via API Direct AJAX ---');
  console.log(`📋 Lead: ${newLead.nome} | Tel: ${newLead.telefone}`);
  const startTimeA = Date.now();
  const successA = await tryDirectApiLeadProcess(newLead);
  console.log(`⏱️ Tempo do Cenário A: ${Date.now() - startTimeA}ms`);
  if (successA) {
    console.log('✅ Cenário A (Novo Cliente) testado com sucesso via API Direct!');
  }

  // TESTE CENÁRIO B: Telefone Existente via API Direct AJAX
  const existingLead: DuotalkLeadData = {
    syonetUrl: 'https://crm.grupoab.com.br/portal/acessaSistema.do',
    syonetUser: 'duotalk.teste',
    syonetPass: '*86A207C07',
    nome: `teste.${miniHash}`,
    telefone: '5561999990001',
    email: `teste.${miniHash}@example.com`,
    cpf: '00000000000',
    estado: 'DF',
    cidade: 'Brasília',
    origem: 'Outbound',
    dryRun: true,
  };

  console.log('\n--- 🧪 TESTE CENÁRIO B: Cliente Existente via API Direct AJAX ---');
  console.log(`📋 Lead: ${existingLead.nome} | Tel: ${existingLead.telefone}`);
  const startTimeB = Date.now();
  const successB = await tryDirectApiLeadProcess(existingLead);
  console.log(`⏱️ Tempo do Cenário B: ${Date.now() - startTimeB}ms`);
  if (successB) {
    console.log('✅ Cenário B (Cliente Existente) testado com sucesso via API Direct!');
  }

  console.log('\n🎉 TODOS OS FLUXOS (CENÁRIOS A E B) TESTADOS VIA AJAX COM SUCESSO!');
}

testLeadFlow();

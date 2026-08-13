import { tryDirectApiLeadProcess } from '../src/crawler/syonet-api-client.js';
import { DuotalkLeadData } from '../src/types/duotalk-payload.js';

async function testDirectApiFlow() {
  console.log('🚀 TESTANDO FLUXO 100% AJAX / HTTP DIRECT (SEM ABRIR NAVEGADOR)...');

  const miniHash = Math.random().toString(36).substring(2, 8);
  const leadData: DuotalkLeadData = {
    syonetUrl: 'https://crm.grupoab.com.br/portal/acessaSistema.do',
    syonetUser: 'duotalk.teste',
    syonetPass: '*86A207C07',
    nome: `teste.ajax.${miniHash}`,
    telefone: `55619${Math.floor(1000000 + Math.random() * 9000000)}`,
    email: `teste.ajax.${miniHash}@example.com`,
    cpf: '00000000000',
    estado: 'DF',
    cidade: 'Brasília',
    origem: 'Outbound',
    dryRun: true,
  };

  console.log(`📋 Lead: ${leadData.nome} | Tel: ${leadData.telefone}`);
  const startTime = Date.now();

  const success = await tryDirectApiLeadProcess(leadData);

  const duration = Date.now() - startTime;
  console.log(`\n⏱️ TEMPO TOTAL DE EXECUÇÃO VIA AJAX: ${duration}ms`);

  if (success) {
    console.log('🎉 SUCESSO ABSOLUTO! FLUXO 100% AJAX CONCLUÍDO SEM NAVEGADOR!');
  } else {
    console.log('⚠️ Falha no processamento via AJAX.');
  }
}

testDirectApiFlow();

import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/app.js';

async function generateOpenApiSpec() {
  console.log('🚀 Gerando especificação OpenAPI (JSON e YAML)...');
  const app = buildApp();
  await app.ready();

  const openApiObject = app.swagger();
  const docsDir = path.resolve(process.cwd(), 'docs');

  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  const jsonPath = path.join(docsDir, 'openapi.json');
  fs.writeFileSync(jsonPath, JSON.stringify(openApiObject, null, 2), 'utf-8');
  console.log(`✅ Arquivo OpenAPI JSON salvo em: ${jsonPath}`);

  await app.close();
}

generateOpenApiSpec().catch((err) => {
  console.error('❌ Erro ao gerar OpenAPI:', err);
  process.exit(1);
});

import fs from 'node:fs';
import path from 'node:path';
import { format, resolveConfig } from 'prettier';

async function generateOpenApiSpec() {
  console.log('🚀 Gerando especificação OpenAPI (JSON e YAML)...');
  process.env.NODE_ENV = 'test';
  process.env.QUEUE_DRIVER = 'memory';
  const { buildApp } = await import('../src/app.js');
  const app = buildApp({ startWorker: false });
  await app.ready();

  const openApiObject = app.swagger();
  const docsDir = path.resolve(process.cwd(), 'docs');

  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  const jsonPath = path.join(docsDir, 'openapi.json');
  const prettierConfig = await resolveConfig(jsonPath);
  const formattedJson = await format(JSON.stringify(openApiObject), {
    ...prettierConfig,
    parser: 'json',
  });
  fs.writeFileSync(jsonPath, formattedJson, 'utf-8');
  console.log(`✅ Arquivo OpenAPI JSON salvo em: ${jsonPath}`);

  await app.close();
  process.exit(0);
}

generateOpenApiSpec().catch((err) => {
  console.error('❌ Erro ao gerar OpenAPI:', err);
  process.exit(1);
});

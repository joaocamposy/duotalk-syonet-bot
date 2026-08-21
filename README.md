# Integração Duotalk → Syonet CRM

API em Fastify, TypeScript e Zod para receber leads do Duotalk, localizar ou atualizar clientes no Syonet CRM e registrar oportunidades.

## Visão geral

- Processa requisições de forma síncrona por padrão; a fila é opcional.
- Recebe URL, credenciais e unidade do Syonet em cada chamada.
- Pesquisa o cliente pelo telefone e atualiza somente os dados divergentes.
- Usa `idConversa` como identidade da oportunidade para evitar duplicações.
- Pode reutilizar uma oportunidade aberta por uma janela configurada em cada requisição.
- Valida os de/para antes da primeira escrita no CRM.
- Oferece `dryRun` para validar autenticação, unidade, pesquisa e mapeamentos sem gravar.

## Execução local

Requisitos: Node.js 20 ou superior e npm.

```bash
cp .env.example .env
npm ci
npm run dev
```

Defina no `.env` um token para autorizar os consumidores:

```env
API_TOKEN=gere-um-token-aleatorio-forte
QUEUE_ENABLED=false
```

Em produção, `API_TOKEN` deve ter pelo menos 32 caracteres. Com a fila habilitada, gere também a chave de criptografia:

```bash
openssl rand -base64 32
```

A interface Swagger fica disponível em `http://localhost:3000/docs` fora de produção. O contrato JSON pode ser obtido em `http://localhost:3000/docs/json`.

## Docker

```bash
docker compose up --build
```

Consulte o [guia de deploy](docs/deployment.md) antes de publicar a API. Ele contém os requisitos de rede, persistência, segredos e topologia suportada.

## Qualidade

```bash
npm run lint
npm run format:check
npm run build
npm test
npm run test:coverage
```

Para enviar um payload local com proteção contra escrita acidental:

```bash
npm run test:lead < payload.local.json
```

O comando aceita `dryRun: true` por padrão. Uma gravação deliberada exige `dryRun: false` no payload e a liberação explícita `ALLOW_WRITE_TEST=true` naquela execução.

## Documentação

- [Uso da API](docs/usage.md): autenticação, envio, modos de processamento e tratamento de respostas.
- [OpenAPI](docs/openapi.json): contrato oficial de campos, formatos e exemplos.
- [Deploy](docs/deployment.md): configuração e operação em produção.
- [Arquitetura](docs/architecture.md): fluxo interno, fila, idempotência e falhas.
- [Integração com o Syonet](docs/integrations/syonet.md): autenticação e chamadas ao CRM.
- [Histórico de mudanças](CHANGELOG.md).
- [Guia de manutenção](AGENTS.md).

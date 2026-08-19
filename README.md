# Duotalk -> Syonet CRM Integration Bot 🤖

API Webhook em **Fastify + TypeScript + Zod** que recebe leads do **Duotalk** e usa as rotas HTTP do **Syonet CRM** para pesquisar clientes, cadastrar contatos e registrar oportunidades.

---

## ⚡ Recursos Principais

- 📞 **Tratamento de Telefone**: Extração automática do DDI (`55`), separação de DDD e número (com e sem hífen).
- 🔄 **Busca Prévia Inteligente**:
  - **Cenário A (Contato Inexistente)**: Preenche e cadastra novo contato.
  - **Cenário B (Contato Existente)**: Reutiliza o cadastro localizado sem sobrescrever dados do cliente.
- 🎯 **Criação de Oportunidade (Novo Evento)**: Registra o evento no CRM vinculado ao contato criado ou localizado.
- ⚡ **Modos de Execução**: Suporte a processamento **Assíncrono via Fila** (padrão 202 Accepted) e **Síncrono sob demanda** (`?sync=true`).
- 🔄 **Desduplicação por tenant**: Ignora requisições repetidas por `idConversa`, `id` ou telefone sem confundir tenants Syonet diferentes.
- 🛑 **Rate Limit**: Proteção contra inundações via `@fastify/rate-limit` configurável no `.env`.
- 📦 **Sistema de Filas Pluggable**: Suporte explícito aos drivers `memory` e `file`, sem fallback silencioso para tecnologias não implementadas.
- 🔐 **Login HTTP criptografado**: Reproduz o fluxo RSA-OAEP e renova a sessão somente ao repetir leituras seguras.
- 🗝️ **Credenciais protegidas**: Recebe o login do Syonet por HTTPS e o criptografa antes de persistir o job.
- 🌐 **Tenant dinâmico**: Recebe URL e credenciais do Syonet em cada requisição.
- 🏬 **Unidade explícita**: Valida `target.companyId` contra a empresa ativa da sessão antes de qualquer operação no CRM.
- 🧭 **De/para isolado e seguro**: Regras provisórias ficam em um único arquivo e valores desconhecidos interrompem o job antes de qualquer escrita.
- 🧾 **Logs estruturados**: Saída JSON em stdout com redação automática de credenciais.
- 🐳 **Docker Ready**: Imagem multi-stage enxuta baseada em Node.js 20 e `docker-compose.yml`.
- 📚 **Swagger Interativo**: Documentação viva acessível em `/docs` somente fora de produção.

---

## 🚀 Como Executar

### 1. Requisitos

- Node.js >= 20
- npm ou docker

### 2. Configuração do `.env`

Copie o arquivo de exemplo e preencha as variáveis de ambiente:

```bash
cp .env.example .env
```

Configure o token dos consumidores e uma chave independente para criptografar a fila:

```env
MICROSERVICE_API_TOKEN=gere-um-token-aleatorio-forte
CREDENTIAL_ENCRYPTION_KEY=gere-com-openssl-rand-base64-32
```

O sistema consumidor usa o token no header:

```http
Authorization: Bearer <MICROSERVICE_API_TOKEN>
```

URL, usuário e senha do Syonet são enviados no objeto `credentials`. Antes do job ser persistido, esses valores são protegidos com AES-256-GCM e removidos do payload do lead.

Até a validação funcional, os de/para ficam centralizados em `src/config/syonet-mappings.ts`. Alterações de forma de contato, tipo de oportunidade ou mídia não exigem mudanças no fluxo HTTP nem na fila.

### 3. Instalação de Dependências

```bash
npm ci
```

### 4. Execução em Desenvolvimento

```bash
npm run dev
```

Acesse a documentação Swagger em: `http://localhost:3000/docs`

### 5. Execução via Docker

```bash
docker compose up --build
```

---

## 🧪 Testes & Qualidade

```bash
# Rodar suíte de testes unitários com Vitest
npm test

# Rodar testes com relatório e limites mínimos de cobertura
npm run test:coverage

# Enviar um payload completo para o microsserviço local
# O JSON deve conter credentials, target e data; use dryRun=true para validar
# unidade, pesquisa e de/para sem executar nenhum POST no Syonet.
npm run test:lead < payload.local.json

# Somente para a gravação real controlada, após conferir o dry-run:
ALLOW_WRITE_TEST=true npm run test:lead < payload.local.json

# Verificar regras do ESLint
npm run lint

# Formatar código com Prettier
npm run format
```

`test:lead` carrega o `.env` automaticamente e bloqueia payloads sem `data.dryRun=true`. A variável de liberação vale somente para o comando local de teste; ela não altera a proteção do endpoint.

---

## 📑 Documentação Detalhada (`docs/`)

- 📐 [Arquitetura & Filas](docs/architecture.md)
- 📩 [Payload do Webhook Duotalk](docs/webhook-payload.md)
- 🤝 [Guia para sistemas consumidores](docs/consumer-integration.md)
- 🔌 [Integração HTTP com o Syonet](docs/syonet-crawler.md)
- 🚀 [Guia de Deploy & Docker](docs/deployment.md)
- 📝 [Histórico de mudanças](CHANGELOG.md)
- 🤖 [Guia de Governança AGENTS.md](AGENTS.md)

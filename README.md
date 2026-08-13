# Duotalk -> Syonet CRM Integration Bot 🤖

API Webhook em **Fastify + TypeScript + Zod** que recebe eventos de leads do **Duotalk** (via n8n) e executa um crawler headless em **Playwright** para pesquisar, cadastrar/atualizar contatos e registrar Oportunidades no **Syonet CRM**.

---

## ⚡ Recursos Principais

- 📞 **Tratamento de Telefone**: Extração automática do DDI (`55`), separação de DDD e número (com e sem hífen).
- 🔄 **Busca Prévia Inteligente**:
  - **Cenário A (Contato Inexistente)**: Preenche e cadastra novo contato.
  - **Cenário B (Contato Existente)**: Valida divergências de Nome/Email e atualiza os dados se estiverem incompletos ou desatualizados.
- 🎯 **Criação de Oportunidade (Novo Evento)**: Registra o evento no CRM vinculado ao contato recém-criado/atualizado.
- ⚡ **Modos de Execução**: Suporte a processamento **Assíncrono via Fila** (padrão 202 Accepted) e **Síncrono sob demanda** (`?sync=true`).
- 🔄 **Desduplicação Inteligente (Dedup)**: Ignora requisições idênticas recentes por `idConversa` ou `telefone` dentro da janela configurável (`DEDUP_WINDOW_MINUTES`).
- 🛑 **Rate Limit**: Proteção contra inundações via `@fastify/rate-limit` configurável no `.env`.
- 📦 **Sistema de Filas Pluggable**: Suporte aos drivers `memory` e `file` (persistência em disco que resiste a crashes) e extensível a `redis`.
- 📸 **Debugging Visual**: Captura automática de screenshot em `logs/screenshots/` em caso de erro na navegação do Playwright.
- 🧹 **Auto-Purge de Logs**: Limpeza automática de arquivos de log e capturas antigas configurável por dias.
- 🐳 **Docker Ready**: Imagem multi-stage baseada no Playwright oficial e `docker-compose.yml`.
- 📚 **Swagger Interativo**: Documentação viva acessível em `/docs`.

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

### 3. Instalação de Dependências & Playwright
```bash
npm install
npx playwright install chromium
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

# Executar teste visual interativo da automação Syonet
npm run test:lead

# Verificar regras do ESLint
npm run lint

# Formatar código com Prettier
npm run format
```

---

## 📑 Documentação Detalhada (`docs/`)

- 📐 [Arquitetura & Filas](docs/architecture.md)
- 📩 [Payload do Webhook Duotalk](docs/webhook-payload.md)
- 🤖 [Crawler Syonet CRM & Seletores](docs/syonet-crawler.md)
- 🚀 [Guia de Deploy & Docker](docs/deployment.md)
- 📑 [Registros de Decisão de Arquitetura (ADRs)](docs/adr/)
- 🤖 [Guia de Governança AGENTS.md](AGENTS.md)

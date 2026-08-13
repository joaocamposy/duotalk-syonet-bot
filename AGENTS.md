# Guia de Desenvolvimento e Manutenção (AGENTS.md)

Este documento fornece as regras, convenções e orientações técnicas para que qualquer desenvolvedor humano ou agente de IA consiga entender a estrutura do projeto e realizar manutenções com segurança dentro dos padrões estabelecidos.

---

## 1. Visão Geral do Projeto

API webhook em **Fastify + TypeScript + Zod** que recebe eventos de leads do **Duotalk / n8n** e executa um crawler headless em **Playwright** para pesquisar, criar/atualizar contatos no **Syonet CRM** e registrar Oportunidades (Eventos).

---

## 2. Estrutura de Pastas e Responsabilidades

- `src/config/env.ts`: Schema Zod e carregamento de variáveis de ambiente.
- `src/types/duotalk-payload.ts`: Schemas Zod de entrada e tipos TypeScript do payload Duotalk.
- `src/utils/`:
  - `phone-parser.ts`: Higienização e separação de DDI (55), DDD e número.
  - `logger.ts`: Logger estruturado em JSON via Pino.
  - `log-purger.ts`: Auto-purge periódico de arquivos de logs e screenshots antigos.
- `src/queue/`:
  - `types.ts`: Interfaces de `QueueDriver`, `LeadJob` e estatísticas.
  - `drivers/memory-queue-driver.ts`: Driver de fila em memória.
  - `drivers/file-queue-driver.ts`: Driver de fila em arquivo JSON (`data/queue.json`) com autorrecuperação pós-crash.
  - `queue-manager.ts`: Factory de filas selecionável por `.env` (`QUEUE_DRIVER`).
- `src/crawler/`:
  - `syonet-browser.ts`: Gerenciamento do Chromium, cookies (`storage_state.json`) e screenshots de erro.
  - `auth.ts`: Login no Syonet e renovação de sessão.
  - `contacts.ts`: Pesquisa por telefone, validação (Cenário A vs Cenário B), criação e atualização de contatos.
  - `events.ts`: Lançamento do Novo Evento / Oportunidade.
  - `syonet-crawler.ts`: Orquestrador principal da automação.
- `src/controllers/lead-controller.ts`: Endpoints HTTP do webhook e consulta da fila.
- `src/routes/lead-routes.ts`: Rotas Fastify e Swagger.
- `src/app.ts` & `src/server.ts`: Inicialização, middlewares e Graceful Shutdown.

---

## 3. Convenções Obrigatórias de Código (Code Style)

1. **Nome de Arquivos e Pastas**: Sempre em `kebab-case` (ex: `phone-parser.ts`, `lead-controller.ts`).
2. **Variáveis e Funções**: Sempre em `camelCase` (ex: `parsePhoneNumber`, `handleDuotalkWebhook`).
3. **Classes, Interfaces e Tipos**: Sempre em `PascalCase` (ex: `FileQueueDriver`, `DuotalkLeadData`).
4. **Constantes Globais**: Sempre em `UPPER_SNAKE_CASE` (ex: `STORAGE_STATE_PATH`).
5. **Tipagem Estrita**: É **proibido** utilizar `any` explícito. Use Zod ou interfaces TypeScript.

---

## 4. Fluxo de Trabalho e Modificações

Se for necessário adicionar uma nova funcionalidade ou ajustar seletores do Syonet:
1. Mantenha os testes existentes passando (`npm test`).
2. Adicione novos testes unitários para novas funções utilitárias ou regras de validação Zod.
3. Se modificar alguma decisão arquitetural, crie ou atualize um registro em `docs/adr/`.
4. Antes de concluir, execute obrigatoriamente:
   ```bash
   npm run lint
   npm run format
   npm test
   ```

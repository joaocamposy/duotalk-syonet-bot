# Guia de Desenvolvimento e Manutenção (AGENTS.md)

Este documento fornece as regras, convenções e orientações técnicas para que qualquer desenvolvedor humano ou agente de IA consiga entender a estrutura do projeto e realizar manutenções com segurança dentro dos padrões estabelecidos.

---

## 1. Visão Geral do Projeto

API em **Fastify + TypeScript + Zod** que recebe leads e credenciais por cliente do **Duotalk**, protege o login na fila e usa HTTP para pesquisar, criar ou atualizar contatos no **Syonet CRM** e registrar Oportunidades.

---

## 2. Estrutura de Pastas e Responsabilidades

- `src/config/env.ts`: Schema Zod e carregamento de variáveis de ambiente.
- `src/types/lead-request.ts`: Contrato Zod da API e tipos dos dados de lead do Duotalk.
- `src/utils/`:
  - `phone-parser.ts`: Higienização e separação de DDI (55), DDD e número.
  - `logger.ts`: Logs JSON em stdout com redação de segredos para coleta pela plataforma.
  - `sensitive-text.ts`: Redação de tokens presentes em URLs recebidas nos textos do lead.
- `src/auth/api-auth.ts`: Autorização Bearer dos sistemas consumidores.
- `src/queue/`:
  - `types.ts`: Interfaces de `QueueDriver`, `LeadJob` e estatísticas.
  - `drivers/disabled-queue-driver.ts`: Driver inerte usado quando `QUEUE_ENABLED=false`.
  - `drivers/memory-queue-driver.ts`: Driver de fila em memória.
  - `drivers/file-queue-driver.ts`: Driver de fila em arquivo JSON (`data/queue.json`) com recuperação conservadora pós-crash.
  - `queue-manager.ts`: Factory de filas selecionável por `.env` (`QUEUE_DRIVER`).
- `src/integrations/syonet/`:
  - `api-client.ts`: Pesquisa, criação ou atualização de cliente e registro da oportunidade via HTTP.
  - `auth-service.ts`: Login RSA por HTTP, cookies e validação da sessão.
  - `credentials.ts`: Validação e criptografia AES-256-GCM do login Syonet.
  - `errors.ts`: Códigos de erro e classificação de incompatibilidades do Syonet.
  - `lead-processor.ts`: Orquestrador do processamento de cada job.
  - `mapping-config.ts`: Único ponto dos de/para funcionais entre Duotalk e Syonet.
  - `mapping.ts`: Seleção fail-closed de forma de contato, tipo de evento e mídia.
  - `target.ts`: Schema do destino Syonet informado fora do payload Duotalk.
  - `time-zone.ts`: Fuso fixo usado no processo e nas chamadas ao Syonet.
- `src/controllers/lead-controller.ts`: Endpoint de leads e consulta da fila.
- `src/routes/lead-routes.ts`: Rotas Fastify e Swagger.
- `src/shutdown/graceful-shutdown.ts`: Encerramento HTTP e espera limitada dos jobs ativos.
- `src/app.ts` & `src/server.ts`: Inicialização, middlewares e Graceful Shutdown.

---

## 3. Convenções Obrigatórias de Código (Code Style)

1. **Nome de Arquivos e Pastas**: Sempre em `kebab-case` (ex: `phone-parser.ts`, `lead-controller.ts`).
2. **Variáveis e Funções**: Sempre em `camelCase` (ex: `parsePhoneNumber`, `handleLeadRequest`).
3. **Classes, Interfaces e Tipos**: Sempre em `PascalCase` (ex: `FileQueueDriver`, `DuotalkLeadData`).
4. **Constantes Globais**: Sempre em `UPPER_SNAKE_CASE` (ex: `QUEUE_FILE_PATH`).
5. **Tipagem Estrita**: É **proibido** utilizar `any` explícito. Use Zod ou interfaces TypeScript.

---

## 4. Fluxo de Trabalho e Modificações

Se for necessário adicionar uma nova funcionalidade ou ajustar contratos/rotas do Syonet:

1. Mantenha os testes existentes passando (`npm test`).
2. Adicione novos testes unitários para novas funções utilitárias ou regras de validação Zod.
3. Se modificar contratos ou comportamento operacional, atualize a documentação permanente correspondente em `docs/`.
4. Antes de concluir, execute obrigatoriamente:
   ```bash
   npm run lint
   npm run format
   npm test
   ```

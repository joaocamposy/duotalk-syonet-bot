# Arquitetura e Ciclo de Vida da Requisição

Este documento descreve a arquitetura interna do sistema de integração entre Duotalk e Syonet CRM.

## Visão Geral do Ciclo de Vida

1. **Recepção (Fastify Controller)**:
   - A requisição `POST /webhook/duotalk` é recebida.
   - O payload é validado via **Zod** (`duotalkWebhookSchema`). Se houver erro de campos obrigatórios, retorna `400 Bad Request`.
2. **Enfileiramento (Queue Manager)**:
   - O payload validado é passado ao `queueInstance`.
   - Dependendo da variável `QUEUE_DRIVER`, o job é registrado em memória (`memory`) ou persistido em disco no arquivo `data/queue.json` (`file`).
   - A API responde imediatamente `202 Accepted` com o `jobId`.
3. **Processamento Assíncrono (Worker & Playwright)**:
   - O worker processa os jobs respeitando a concorrência (`QUEUE_CONCURRENCY`).
   - O `phoneParser` extrai o DDI (55), DDD e Número do telefone.
   - A automação em Playwright inicializa/reutiliza o navegador Chromium e a sessão autenticada (`storage_state.json`).
4. **Resiliência pós-crash**:

## Proteção, Limitação e Desduplicação (Dedup & Rate Limit)

- 🛑 **Rate Limit (@fastify/rate-limit)**:
  - Protege a API contra inundação de requisições maliciosas ou loops de webhook.
  - Configurável no `.env` via `RATE_LIMIT_MAX` (padrão: 100) e `RATE_LIMIT_TIME_WINDOW` (padrão: 1 minute).
  - Retorna `HTTP 429 Too Many Requests` quando excedido.

- 🔄 **Desduplicação Inteligente (Dedup)**:
  - Evita re-enfileirar requisições repetidas disparadas em curto intervalo (ex: retries de webhook ou cliques duplos).
  - Identifica duplicatas por `idConversa`, `id` do lead ou pelo número de telefone sanitizado (`phone_5561999990001`).
  - Janela de desduplicação configurável via `DEDUP_WINDOW_MINUTES` (padrão: 5 minutos).
  - Retorna `HTTP 200 OK` com `duplicate: true` e reutiliza o `jobId` existente sem acionar o crawler novamente.

- Se o servidor for interrompido bruscamente, o driver `file` recarrega os jobs não concluídos do arquivo na inicialização e reseta o status para `pending`, evitando perda de dados.

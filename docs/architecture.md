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
3. **Processamento Assíncrono (Worker & HTTP)**:
   - O worker processa os jobs respeitando a concorrência (`QUEUE_CONCURRENCY`).
   - O Bearer autentica o sistema consumidor do microsserviço.
   - A origem informada é confrontada com `SYONET_ALLOWED_HOSTS` antes de qualquer acesso de rede.
   - O login do Syonet recebido no corpo é criptografado antes de entrar na fila.
   - `target.companyId`, fornecido pelo consumidor fora de `data`, precisa coincidir com a empresa ativa da sessão antes de qualquer pesquisa ou escrita.
   - O worker descriptografa o envelope somente em memória durante o processamento.
   - O `phoneParser` extrai o DDI (55), DDD e Número do telefone.
   - A integração autentica por HTTP, reutiliza os cookies em memória e chama as APIs de cliente e evento do Syonet.
   - De/para funcionais são resolvidos antes da primeira escrita; mapeamentos desconhecidos falham com código estável e sem retry.
   - Respostas do Syonet são validadas antes de serem usadas e todas as chamadas possuem timeout.
4. **Resiliência pós-crash**:
   - Jobs que ainda estavam `pending` voltam a ficar disponíveis ao worker.
   - Jobs encontrados em `processing` são encerrados como falha ambígua para conciliação, pois uma escrita no CRM pode ter sido confirmada antes da queda.
   - O envelope de credenciais e o payload pessoal do lead são removidos assim que o job chega a `completed` ou `failed`.
   - Durante um shutdown gracioso, o worker para de retirar jobs e aguarda somente os que já estavam ativos; jobs pendentes permanecem na fila persistida.

## Proteção, Limitação e Desduplicação (Dedup & Rate Limit)

- 🛑 **Rate Limit (@fastify/rate-limit)**:
  - Protege a API contra inundação de requisições maliciosas ou loops de webhook.
  - Configurável no `.env` via `RATE_LIMIT_MAX` (padrão: 100) e `RATE_LIMIT_TIME_WINDOW` (padrão: 1 minute).
  - Retorna `HTTP 429 Too Many Requests` quando excedido.
  - Todas as requisições com o Bearer válido compartilham um limite; tentativas inválidas compartilham o limite do endereço visto pelo Fastify. Atrás do proxy recomendado, isso forma um único bucket de tráfego não autenticado no proxy. Variações de caixa, espaços ou tokens inválidos não criam buckets ilimitados, e o token nunca é registrado.

- 🔄 **Desduplicação Inteligente (Dedup)**:
  - Evita re-enfileirar requisições repetidas disparadas em curto intervalo (ex: retries de webhook ou cliques duplos).
  - Isola a chave por origem, `companyId` e modo `dry-run`/gravação usando um hash; a URL não é persistida em texto claro na chave.
  - Dentro do tenant, identifica duplicatas por domínios separados de `idConversa`, `id` do lead ou número de telefone. Um HMAC com a chave do deploy impede que esses identificadores sejam persistidos em texto claro ou enumerados diretamente a partir da chave.
  - `idConversa` ou `id` permanecem deduplicados durante `JOB_RETENTION_DAYS`; o fallback por telefone usa `DEDUP_WINDOW_MINUTES`.
  - Uma duplicata concluída retorna `200`; se ainda estiver pendente ou em processamento, retorna `202`. Ambos reutilizam o `jobId` existente sem processar o lead novamente.
  - Jobs falhos por unidade ou de/para podem ser reenviados depois da correção; outras falhas duplicadas retornam `409`.
  - Não existe bypass público da deduplicação.
  - `QUEUE_MAX_JOBS` limita crescimento de memória/disco. Jobs terminais mais antigos podem sair antes da retenção temporal para abrir espaço; se não houver job terminal removível, a API aplica backpressure com `503`.

## Segurança de retries

Falhas transitórias anteriores a uma escrita usam atraso exponencial. Se a conexão falhar depois que um `POST` ao Syonet foi iniciado, o job é marcado como falho para conciliação e não é repetido automaticamente, pois o CRM pode ter confirmado a operação sem a resposta chegar ao serviço.

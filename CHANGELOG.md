# Changelog

Todas as mudanças relevantes deste projeto são registradas neste arquivo.

## Não publicado

### Alterado

- Integração HTTP direta com o Syonet.
- Credenciais e URL do Syonet passam a ser recebidas por requisição no objeto `credentials`.
- Unidade de destino passa a ser obrigatória em `target.companyId` e é validada antes de qualquer pesquisa ou escrita.
- Fila em arquivo passa a usar persistência atômica, limite de capacidade, retenção e recuperação conservadora após falhas.
- `dryRun` passa a validar empresa, pesquisa e abertura do cliente e todos os de/para sem executar `POST` ou `PATCH`.
- Contatos existentes passam a ser abertos e atualizados parcialmente por `PATCH` quando nome, email informado ou telefone celular estiverem desatualizados.
- Resultado do job passa a informar em `clientUpdated` se houve atualização do cadastro existente.
- A API passa a rejeitar com `503` qualquer lead quando não existe worker ativo, sem aceitar jobs que ficariam indefinidamente pendentes.
- Adiciona `QUEUE_ENABLED` como circuit breaker anterior à verificação do worker; quando desabilitado, usa driver inerte e responde `503` sem criar job.
- Esgotamento de `SYNC_TIMEOUT_MS` passa a responder `504` com `jobId`, em vez de apresentar o processamento ainda inconclusivo como uma aceitação assíncrona normal.
- Remove `TZ` da configuração externa e centraliza o fuso comercial fixo em código.
- Renomeia `MICROSERVICE_API_TOKEN` para `API_TOKEN` em todo o contrato operacional.
- Renomeia o módulo de autenticação para `api-auth.ts`, alinhado ao novo nome do token.
- Move o fuso fixo para a pasta da integração Syonet, deixando explícita sua responsabilidade.
- Consolida todos os módulos exclusivos em `src/integrations/syonet/` e sua documentação em `docs/integrations/`.
- Substitui `POST /webhook/duotalk` por `POST /leads` e remove a terminologia de webhook do contrato interno.
- Resultado do job passa a informar os valores escolhidos em `mapping`.
- Reenvios da mesma `idConversa` passam a reutilizar a oportunidade existente no Syonet, sem impedir a atualização do contato; o resultado informa a decisão em `eventCreated`.
- Dry-run e gravação passam a ter chaves de deduplicação independentes.
- Persistência de runtime da fila em arquivo passa a usar I/O assíncrono serializado.

### Segurança

- Autorização Bearer obrigatória nos endpoints operacionais.
- Credenciais do Syonet protegidas com AES-256-GCM antes de entrar na fila.
- URL e credenciais do tenant Syonet fornecidas dinamicamente pelo consumidor autenticado.
- Remoção de credenciais e dados pessoais dos resultados públicos e dos jobs terminais.
- Redação de tokens encontrados em URLs dos textos recebidos.
- Bloqueio de repetição automática quando uma escrita no CRM pode ter resultado ambíguo.
- Comando local de homologação bloqueia gravações sem `ALLOW_WRITE_TEST=true`.
- Swagger desabilitado em produção, porta do Compose restrita ao host local e shutdown com prazo único para requisições e jobs ativos.
- Rate limit resistente a variações de formatação do Bearer e chaves de deduplicação sem identificadores pessoais em texto claro.

### Removido

- Variáveis `SYONET_URL`, `SYONET_USER` e `SYONET_PASS` do ambiente do microsserviço.
- Drivers e fallbacks anunciados, mas não implementados.
- Campos fabricados que não existem no payload de referência do Duotalk.

### Validação

- Suíte automatizada, cobertura mínima obrigatória, lint, formatação e compilação TypeScript.
- Contrato OpenAPI regenerado a partir das rotas.

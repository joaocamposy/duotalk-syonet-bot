# Changelog

Todas as mudanças relevantes deste projeto são registradas neste arquivo.

## Não publicado

### Alterado

- Integração HTTP direta com o Syonet.
- Credenciais e URL do Syonet passam a ser recebidas por requisição no objeto `credentials`.
- Unidade de destino passa a ser obrigatória em `target.companyId` e é validada antes de qualquer pesquisa ou escrita.
- Fila em arquivo passa a usar persistência atômica, limite de capacidade, retenção e recuperação conservadora após falhas.
- `dryRun` passa a validar empresa, pesquisa e abertura do cliente e todos os de/para sem executar `POST` ou `PATCH`.
- `dryRun` passa a ficar na raiz da requisição, mantendo `data` dedicado exclusivamente aos dados do lead.
- Contatos existentes passam a ser abertos e atualizados parcialmente por `PATCH` quando nome, email informado ou telefone celular estiverem desatualizados.
- Resultado do job passa a informar em `clientUpdated` se houve atualização do cadastro existente.
- O processamento síncrono direto passa a ser o padrão de `POST /leads`, sem depender de fila ou processador separado.
- `QUEUE_ENABLED` passa a controlar somente a disponibilidade do modo assíncrono; seu padrão é `false`, e `?sync=false` retorna `503` quando a fila está desabilitada.
- Com a fila habilitada, a API rejeita com `503` qualquer solicitação quando não existe processador ativo, sem aceitar jobs que ficariam indefinidamente pendentes.
- Esgotamento de `SYNC_TIMEOUT_MS` passa a responder `504` com `jobId`, em vez de apresentar o processamento ainda inconclusivo como uma aceitação assíncrona normal.
- Remove `TZ` da configuração externa e centraliza o fuso comercial fixo em código.
- Renomeia o token de acesso legado para `API_TOKEN` em todo o contrato operacional.
- Renomeia o módulo de autenticação para `api-auth.ts`, alinhado ao novo nome do token.
- Move o fuso fixo para a pasta da integração Syonet, deixando explícita sua responsabilidade.
- Consolida todos os módulos exclusivos em `src/integrations/syonet/` e sua documentação em `docs/integrations/`.
- Consolida a entrada de leads em `POST /leads` e remove a terminologia anterior do contrato interno.
- Resultado do job passa a informar os valores escolhidos em `mapping`.
- Reenvios da mesma `idConversa` passam a reutilizar a oportunidade existente no Syonet, sem impedir a atualização do contato; o resultado informa a decisão em `eventCreated`.
- `daysToUpdateOpenEvent` passa a reutilizar a oportunidade aberta mais recente do mesmo cliente, empresa, grupo e tipo dentro da janela informada, registrando a nova observação como comentário.
- Dry-run e gravação passam a ter chaves de deduplicação independentes.
- Persistência de runtime da fila em arquivo passa a usar I/O assíncrono serializado.
- Gravações passam a exigir `idConversa`, e a deduplicação usa um marcador técnico reservado sem depender do tipo atual do evento.
- Chamadas ao Syonet passam a ter prazo total de processamento e limite de tamanho por resposta JSON.
- Falhas de autenticação, contrato, conflito e escrita passam a fornecer códigos sanitizados estáveis.
- Consolida o guia do consumidor em `docs/usage.md`, mantendo campos e exemplos completos somente no OpenAPI.

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
- Arquivos de fila restaurados têm a permissão `0600` reaplicada antes da leitura.

### Removido

- Variáveis `SYONET_URL`, `SYONET_USER` e `SYONET_PASS` do ambiente da API.
- Drivers e alternativas anunciados, mas não implementados.
- Campos fabricados que não existem no payload de referência do Duotalk.

### Validação

- Suíte automatizada, cobertura mínima obrigatória, lint, formatação e compilação TypeScript.
- Contrato OpenAPI regenerado a partir das rotas.

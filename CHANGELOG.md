# Changelog

Todas as mudanças relevantes deste projeto são registradas neste arquivo.

## Não publicado

### Alterado

- Substituição integral da automação Playwright pela integração HTTP com o Syonet.
- Credenciais e URL do Syonet passam a ser recebidas por requisição no objeto `credentials`.
- Unidade de destino passa a ser obrigatória em `target.companyId` e é validada antes de qualquer pesquisa ou escrita.
- Fila em arquivo passa a usar persistência atômica, limite de capacidade, retenção e recuperação conservadora após falhas.
- `dryRun` passa a validar empresa, pesquisa do cliente e todos os de/para sem executar `POST`.
- Resultado do job passa a informar os valores escolhidos em `mapping`.
- Dry-run e gravação passam a ter chaves de deduplicação independentes.
- Persistência de runtime da fila em arquivo passa a usar I/O assíncrono serializado.

### Segurança

- Autorização Bearer obrigatória nos endpoints operacionais.
- Credenciais do Syonet protegidas com AES-256-GCM antes de entrar na fila.
- Allowlist de destinos Syonet para reduzir risco de SSRF.
- Allowlist passa a aceitar somente hostnames exatos e falha fechada quando vazia.
- Remoção de credenciais e dados pessoais dos resultados públicos e dos jobs terminais.
- Redação de tokens encontrados em URLs dos textos recebidos.
- Bloqueio de repetição automática quando uma escrita no CRM pode ter resultado ambíguo.
- Comando local de homologação bloqueia gravações sem `ALLOW_WRITE_TEST=true`.
- Swagger desabilitado em produção, porta do Compose restrita ao host local e shutdown com prazo único para requisições e jobs ativos.
- Rate limit resistente a variações de formatação do Bearer e chaves de deduplicação sem identificadores pessoais em texto claro.

### Removido

- Playwright, Chromium, automação de DOM, screenshots e persistência de sessão em disco.
- Variáveis `SYONET_URL`, `SYONET_USER` e `SYONET_PASS` do ambiente do microsserviço.
- Drivers e fallbacks anunciados, mas não implementados.
- Campos fabricados que não existem no payload de referência do Duotalk.

### Validação

- Suíte automatizada, cobertura mínima obrigatória, lint, formatação e compilação TypeScript.
- Contrato OpenAPI regenerado a partir das rotas.
- Auditoria integral e red team documentados em `docs/audit-2026-08-14.md`.

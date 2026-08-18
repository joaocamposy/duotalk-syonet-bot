# Red team independente — Claude Opus — 2026-08-18

## Escopo

O Claude Code 2.1.232, autenticado com o modelo Opus e esforço alto, revisou em modo somente leitura os commits locais `13fa835` e `9171b79` contra o pai `61b8469`. A revisão cobriu o diff integral, código, testes, deploy, OpenAPI e documentação. Nenhuma chamada foi feita a um Syonet real.

O relatório original foi mantido fora do repositório porque a evidência do achado crítico contém um segredo histórico. Este documento registra somente a versão sanitizada e as providências.

## Primeira passagem

O veredito inicial foi de bloqueio, com um achado crítico e seis altos:

| ID  | Severidade | Achado                                                              | Providência                                                                                     |
| --- | ---------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| C1  | Crítica    | Credencial Syonet presente no histórico Git                         | Rotação externa obrigatória; reescrita do histórico deve ser coordenada antes da publicação.    |
| H1  | Alta       | Resposta de rate limit convertida de `429` para `500`               | Corrigida e coberta por teste de rota.                                                          |
| H2  | Alta       | Persistência síncrona da fila bloqueava o event loop                | Runtime convertido para I/O assíncrono serializado; histórico retido foi limitado.              |
| H3  | Alta       | Keep-alive podia ultrapassar o timeout de shutdown                  | Conexões são encerradas pelo Fastify e o grace period do Compose foi explicitado.               |
| H4  | Alta       | Dry-run e gravação real colidiam na deduplicação                    | Modos separados; falhas configuráveis podem ser reenviadas; falha duplicada retorna `409`.      |
| H5  | Alta       | Allowlist vazia/abrangente permitia destino controlado por atacante | Fail-closed, somente hostnames exatos e revalidação nas fronteiras de rede.                     |
| H6  | Alta       | Consulta de job expunha dados pessoais a qualquer portador do token | Payload, destino e erro bruto removidos da resposta; documentado um único domínio de confiança. |

Também foram tratados apontamentos médios e baixos sobre rate limit atrás de proxy, Swagger público, bind do Compose, fallback `INTERNET`, descarte de PII terminal, tamanho do login RSA, repetição após `401/403` explícito e dados reais em exemplos.

## Segunda passagem

A segunda revisão confirmou o fechamento de H1, H3, H4, H5 e H6 e rebaixou H2: a persistência continua limitada ao driver local de processo único, mas o maior bloqueio observado do event loop caiu de aproximadamente 250 ms para 26 ms no ensaio do revisor. Ela encontrou três regressões relevantes, corrigidas antes dos commits finais:

- variações válidas e inválidas do Bearer podiam criar buckets independentes no rate limit;
- o fallback de telefone ainda aparecia em texto claro na chave persistida de deduplicação;
- conexões HTTP ativas eram encerradas imediatamente, em vez de receberem o orçamento de shutdown.

Também foi restaurada a regra conservadora de nunca repetir automaticamente um `POST` após `401` ou `403`. A fila corrompida permanece fail-stop por decisão arquitetural; o procedimento de backup, conciliação e restauração está documentado em `docs/deployment.md`.

## Passagem final

O Opus verificou novamente o diff completo e declarou o projeto **apto para reorganizar os commits locais**, sem achados altos ou médios. Na confirmação focada, os seis requisitos da segunda passagem foram aprovados. Os itens baixos restantes também foram fechados antes dos commits:

- o shutdown observa rejeições sem criar promise órfã, cancela o timer e força conexões se o fechamento falhar;
- `idConversa`, `id` e telefone usam domínios separados e HMAC com chave derivada por separação de domínio;
- `QUEUE_FILE_PATH` e as demais variáveis operacionais documentadas chegam ao Compose;
- testes cobrem o fallback por telefone, resposta `409` e reenvio permitido após erro configurável;
- o runbook explica o efeito de uma futura rotação da chave de criptografia sobre a deduplicação.

O veredito de publicação permanece **não apto** exclusivamente enquanto não houver confirmação externa da rotação da credencial histórica.

## Bloqueio externo restante

A aplicação não consegue rotacionar a credencial encontrada no histórico. O responsável pelo Syonet deve tratá-la como comprometida e confirmar a rotação antes de qualquer push ou compartilhamento. Reescrever o histórico local não substitui a rotação, pois clones, backups ou remotos anteriores podem preservar o segredo.

## Gates executados

Antes de recriar os commits foram executados:

1. executar lint, formatação, testes, cobertura, build e regeneração determinística do OpenAPI;
2. executar uma passagem final do Claude Opus sobre as correções da segunda revisão;
3. corrigir todo novo achado bloqueador ou registrar claramente o risco externo;
4. fechamento dos itens baixos encontrados na confirmação focada.

Antes de qualquer push ou compartilhamento, confirmar a rotação da credencial histórica. A publicação continua bloqueada até essa ação externa.

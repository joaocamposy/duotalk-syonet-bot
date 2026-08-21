# Arquitetura

Este documento descreve o fluxo interno da integração Duotalk → Syonet. Para enviar requisições, consulte o [guia de uso](usage.md); para configurar o ambiente, consulte o [guia de deploy](deployment.md).

## Entrada da API

`POST /leads` passa por quatro etapas antes do processamento:

1. limitação de requisições;
2. leitura e validação estrutural do corpo e da query pelo Fastify;
3. validação do Bearer do consumidor;
4. validação e normalização do contrato pelo Zod.

O contrato separa responsabilidades:

- `credentials` identifica e autentica o tenant Syonet;
- `target.companyId` declara a unidade esperada;
- `dryRun` controla a execução;
- `data` contém somente os dados do lead.

## Modos de processamento

### Síncrono direto

É o fluxo padrão quando `QUEUE_ENABLED=false`. A própria requisição executa a integração e retorna o resultado final. As credenciais permanecem somente em memória, e nenhum job é criado.

Uma chamada com `?sync=false` é recusada com `503`, pois não existe processamento em segundo plano sem fila.

### Fila opcional

Com `QUEUE_ENABLED=true`, toda requisição cria ou reutiliza um job. O driver pode ser:

- `memory`: estado efêmero, perdido no encerramento do processo;
- `file`: estado persistido em `data/queue.json`.

O processador da fila respeita `QUEUE_CONCURRENCY`. Com `?sync=false`, a API retorna `202` assim que o job é aceito. Sem o parâmetro, aguarda o resultado até `SYNC_TIMEOUT_MS`; depois desse prazo, retorna `504` com o `jobId`, mas não cancela o processamento.

A API não aceita novos jobs quando a fila está sem processador ou sem capacidade.

## Processamento no Syonet

O fluxo comum aos dois modos:

1. autentica no Syonet e valida a sessão;
2. confirma que a empresa ativa corresponde a `target.companyId`;
3. pesquisa o cliente pelo telefone e exige correspondência exata;
4. abre e compara o cadastro quando o cliente já existe;
5. resolve forma de contato, tipo de evento e mídia;
6. cria ou atualiza o cliente, se necessário;
7. reutiliza a oportunidade da mesma `idConversa`;
8. opcionalmente, reutiliza uma oportunidade aberta compatível conforme `daysToUpdateOpenEvent` e adiciona a observação como comentário;
9. cria uma nova oportunidade quando nenhuma das regras anteriores encontra correspondência.

Todas as respostas do Syonet têm limite de tamanho e validação de contrato. Cada chamada possui limite de tempo próprio, e o processamento completo possui um prazo total. Os detalhes das rotas e da autenticação estão em [Integração com o Syonet](integrations/syonet.md).

## Idempotência

A proteção ocorre em duas camadas.

### Na fila

A chave combina ambiente Syonet, unidade, modo (`dryRun` ou gravação), identidade do lead e estado normalizado do contato. Os valores identificáveis são protegidos por HMAC antes da persistência.

- Para `idConversa` ou `id`, a proteção acompanha a retenção do job.
- O telefone é usado como alternativa em homologações sem identificador, respeitando `DEDUP_WINDOW_MINUTES`; gravações exigem `idConversa`.
- Dados de contato alterados produzem outra chave, permitindo atualizações legítimas.
- Jobs falhos por autenticação, unidade ou de/para podem ser reenviados depois da correção.
- Outras falhas repetidas retornam `409` até a conciliação.

### No Syonet

A observação da oportunidade recebe um marcador técnico derivado de `idConversa`. Antes de criar um evento, a integração pesquisa as oportunidades do cliente e da empresa sem restringir o tipo atual.

Se encontrar exatamente um marcador correspondente, reutiliza o evento. Se encontrar mais de um, ou se a pesquisa atingir o limite sem comprovar a ausência, encerra o processamento com `SYONET_DATA_CONFLICT`.

Quando `daysToUpdateOpenEvent` é maior que zero, uma segunda regra procura a oportunidade aberta mais recente do mesmo cliente, empresa, grupo e tipo cuja criação esteja dentro da janela. A integração registra a observação como comentário; o marcador da conversa nesse comentário impede repetições posteriores.

Um bloqueio local serializa a mesma conversa ou, quando a política de dias está ativa, o mesmo telefone dentro da instância, reduzindo corridas entre requisições simultâneas.

## Falhas e tentativas

Falhas transitórias anteriores a uma escrita podem ser repetidas com atraso exponencial. Depois que um `POST` ou `PATCH` é iniciado, falha de rede, limite de tempo, redirecionamento ou resposta inválida tornam o resultado ambíguo; a operação não é repetida automaticamente.

No driver `file`, um job encontrado como `processing` após reinício também é encerrado como ambíguo. Essa decisão evita repetir uma escrita que o CRM pode ter confirmado antes da interrupção.

Jobs terminais deixam de armazenar credenciais e dados pessoais. Permanecem apenas status, identificadores técnicos, código de erro e resultado sanitizado durante o período de retenção.

## Encerramento

Ao receber `SIGTERM` ou `SIGINT`, a aplicação:

1. deixa de retirar novos jobs;
2. para de aceitar novas conexões;
3. aguarda requisições e jobs ativos até `SHUTDOWN_TIMEOUT_MS`;
4. encerra as conexões restantes ao fim do prazo.

Jobs pendentes sobrevivem apenas no driver `file`.

## Limites atuais

Os bloqueios, o cache de sessões e a coordenação da fila pertencem ao processo. A versão atual suporta uma única instância ativa. Escalabilidade horizontal exige fila compartilhada com reserva atômica e bloqueio distribuído por tenant, unidade e conversa.

Todas as requisições com Bearer válido também compartilham o mesmo limite de tráfego. Esse modelo pressupõe um único sistema consumidor confiável; múltiplos consumidores independentes exigem autenticação e cotas isoladas.

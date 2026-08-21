# Deploy e operação

Este guia reúne os requisitos para executar a API em produção. A relação completa de variáveis e seus valores padrão está em [.env.example](../.env.example).

## Preparação

Crie o arquivo de ambiente e defina um Bearer exclusivo para os sistemas consumidores:

```bash
cp .env.example .env
openssl rand -hex 32
```

Configure o valor gerado em `API_TOKEN` e use `NODE_ENV=production`. Em produção, a aplicação recusa tokens com menos de 32 caracteres e não publica o Swagger.

O processamento síncrono direto é o padrão e não exige chave de criptografia:

```env
NODE_ENV=production
API_TOKEN=<token-gerado>
QUEUE_ENABLED=false
```

Para habilitar a fila, gere uma chave AES de 32 bytes:

```bash
openssl rand -base64 32
```

```env
QUEUE_ENABLED=true
QUEUE_DRIVER=file
CREDENTIAL_ENCRYPTION_KEY=<chave-gerada>
```

A aplicação valida essa chave sempre que a fila está habilitada, independentemente do ambiente.

## Docker Compose

```bash
docker compose up --build -d
```

A imagem usa Node.js 20, executa como usuário sem privilégios e inclui um healthcheck em `GET /health`. O Compose publica a porta somente em `127.0.0.1:3000` e mantém 45 segundos de tolerância para o encerramento gracioso.

## Configuração operacional

| Variável                         |     Padrão | Finalidade                                                         |
| -------------------------------- | ---------: | ------------------------------------------------------------------ |
| `QUEUE_ENABLED`                  |    `false` | Habilita a fila e o processamento em segundo plano.                |
| `QUEUE_DRIVER`                   |     `file` | Escolhe persistência local (`file`) ou memória efêmera (`memory`). |
| `QUEUE_CONCURRENCY`              |        `1` | Limita jobs processados simultaneamente; aceita de 1 a 10.         |
| `QUEUE_MAX_JOBS`                 |     `1000` | Aplica contrapressão quando não há espaço seguro para outro job.   |
| `QUEUE_RETRY_BASE_DELAY_MS`      |     `1000` | Define a base do atraso exponencial entre tentativas seguras.      |
| `DEDUP_WINDOW_MINUTES`           |        `5` | Define a janela da deduplicação por telefone.                      |
| `JOB_RETENTION_DAYS`             |        `7` | Retém resultados terminais e fingerprints de deduplicação.         |
| `SYONET_HTTP_TIMEOUT_MS`         |    `15000` | Limita cada chamada ao Syonet.                                     |
| `SYONET_HTTP_MAX_RESPONSE_BYTES` |  `2097152` | Limita cada resposta JSON do Syonet a 2 MiB.                       |
| `SYONET_PROCESS_TIMEOUT_MS`      |    `60000` | Limita o processamento completo de um lead.                        |
| `SYNC_TIMEOUT_MS`                |    `60000` | Limita a espera síncrona por um job sem cancelá-lo.                |
| `SHUTDOWN_TIMEOUT_MS`            |    `30000` | Limita a espera por requisições e jobs ativos no encerramento.     |
| `RATE_LIMIT_MAX`                 |      `100` | Limita requisições por janela.                                     |
| `RATE_LIMIT_TIME_WINDOW`         | `1 minute` | Define a janela do limite de tráfego.                              |
| `LOG_LEVEL`                      |     `info` | Define o nível mínimo dos logs estruturados.                       |

`QUEUE_FILE_PATH`, `PORT` e `HOST` normalmente não precisam ser alterados no Compose. Consulte `.env.example` quando o deploy não usar essa configuração.

## Topologia e rede

Execute exatamente uma réplica desta versão. Os bloqueios de conversa e enfileiramento são locais ao processo, e o driver `file` não aceita escritores concorrentes. Escalabilidade horizontal exige fila compartilhada com reserva atômica e bloqueio distribuído.

Publique a API por um proxy HTTPS ou por uma rede interna protegida. Como o consumidor escolhe dinamicamente o host do Syonet, aplique também uma política de saída que bloqueie loopback, redes privadas, endereços link-local e endpoints de metadados da infraestrutura. A validação da URL pela aplicação não elimina o risco de DNS rebinding.

## Persistência da fila

Com `QUEUE_DRIVER=file`, o Compose mantém `data/queue.json` em um volume nomeado. Jobs pendentes guardam dados pessoais em texto claro e credenciais cifradas; proteja o volume e seus backups com criptografia e controle de acesso. Jobs terminais não mantêm o payload nem o envelope de credenciais.

O arquivo recebe permissão `0600`. No host, aplique a mesma permissão ao `.env` e a qualquer arquivo que contenha sessão ou segredo.

### Recuperação

O driver interrompe a inicialização se o arquivo estiver vazio, malformado ou inconsistente. Não substitua nem apague o volume automaticamente: preserve uma cópia, valide o JSON e restaure o último backup íntegro. Sem backup, reconcilie os jobs com o Syonet antes de reconstruir a fila.

Jobs encontrados como `processing` após um reinício são marcados como falha ambígua e não voltam à fila automaticamente.

### Rotação da chave

`CREDENTIAL_ENCRYPTION_KEY` cifra as credenciais e deriva, com separação de domínio, a chave dos fingerprints de deduplicação. Antes de rotacioná-la:

1. interrompa novos envios;
2. aguarde até não haver jobs pendentes ou ativos;
3. preserve o inventário dos jobs ainda retidos;
4. substitua a chave e reinicie a aplicação.

Após a troca, fingerprints antigos não reconhecem novos reenvios. Concilie identificadores que ainda estejam dentro da janela de retenção.

## Encerramento e observabilidade

Configure no orquestrador um período de encerramento superior a `SHUTDOWN_TIMEOUT_MS`. Jobs pendentes sobrevivem no driver `file`; no driver `memory`, são perdidos quando o processo termina.

Os logs são emitidos como JSON em stdout. A plataforma deve fornecer coleta, retenção, alertas e controle de acesso. Credenciais, Bearer e envelopes criptografados são redigidos pelo logger.

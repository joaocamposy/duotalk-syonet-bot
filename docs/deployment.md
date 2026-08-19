# Guia de Deploy e Produção

Orientações para colocar o serviço em produção.

## 1. Deploy via Docker (Recomendado)

O projeto possui um `Dockerfile` multi-stage baseado no Node.js 20. A integração usa somente HTTP e não instala navegador ou dependências gráficas.

```bash
docker compose up --build -d
```

O Compose usa um volume nomeado para `data/queue.json`, evitando depender das permissões de uma pasta do host. O conteúdo persiste entre recriações do container enquanto o volume não for removido. Jobs pendentes contêm dados pessoais em claro e exigem volume e backups criptografados; jobs terminais têm o payload removido.

## 2. Variáveis de Ambiente Críticas

- `NODE_ENV=production`
- `API_TOKEN`: token Bearer compartilhado somente com os sistemas consumidores autorizados.
- `CREDENTIAL_ENCRYPTION_KEY`: chave de 32 bytes em Base64 usada para proteger o login do Syonet na fila. Gere com `openssl rand -base64 32`.
- `SYONET_HTTP_TIMEOUT_MS=15000`: limite de cada chamada ao CRM.
- `SYNC_TIMEOUT_MS=60000`: após esse período, a chamada síncrona responde `504` com o `jobId`, sem cancelar o job já aceito.
- `SHUTDOWN_TIMEOUT_MS=30000`: tempo para concluir jobs ativos antes de encerrar o processo.
- `QUEUE_ENABLED=true`: chave operacional da fila. Com `false`, não inicializa o driver configurado nem o worker e `POST /leads` responde `503` sem criar job.
- `QUEUE_RETRY_BASE_DELAY_MS=1000`: base do atraso exponencial para falhas seguramente repetíveis.
- `QUEUE_MAX_JOBS=1000`: limite absoluto de jobs mantidos. Ao atingir o limite, jobs terminais antigos são removidos primeiro; se todos ainda estiverem ativos, novos leads recebem `503`.
- `QUEUE_DRIVER=file` para persistência local ou `memory` para execução efêmera.
- Mesmo com `QUEUE_ENABLED=true`, `POST /leads` responde `503` sem criar job quando não existe worker ativo, inclusive no modo assíncrono.
- `JOB_RETENTION_DAYS=7`: remove jobs concluídos ou falhos e seus dados pessoais após a retenção.
- `LOG_LEVEL=info`: nível dos logs estruturados enviados para stdout.

Use um grace period do orquestrador maior que `SHUTDOWN_TIMEOUT_MS`. O Compose fornece 45 segundos para o padrão de 30 segundos. Ao receber `SIGTERM`, o serviço deixa de aceitar novas conexões, fecha as ociosas, para de retirar jobs e preserva requisições e jobs ativos até o limite. Ao final do prazo, as conexões restantes são encerradas. Jobs pendentes ficam no driver `file` para o próximo start; pendências no driver `memory` são explicitamente reportadas e serão perdidas.

### Recuperação de uma fila inválida

O driver `file` interrompe a inicialização se `data/queue.json` estiver vazio, malformado ou inconsistente. Isso é intencional: substituir a fila automaticamente poderia apagar leads sem aviso. Preserve uma cópia do volume, valide o JSON e restaure a última versão íntegra do backup. Se não houver backup, a decisão de remover ou reconstruir o arquivo exige conciliação dos jobs com o Syonet; não apague o volume como tentativa automática de recuperação.

O Compose publica a porta apenas em `127.0.0.1`. Exponha o serviço por um proxy HTTPS ou pela rede interna do orquestrador. O Swagger não é registrado quando `NODE_ENV=production`.

### Rotação da chave de criptografia

`CREDENTIAL_ENCRYPTION_KEY` também deriva, com separação de domínio, a chave usada nos fingerprints de deduplicação. Antes de rotacioná-la, pause novos envios, deixe a fila persistida sem jobs pendentes e preserve o inventário de jobs recentes. Após a troca, fingerprints antigos não reconhecem novos retries; concilie identificadores ainda dentro da janela de deduplicação para evitar uma gravação repetida. A rotação do login do Syonet é independente e não altera esses fingerprints.

## 3. Logs

Os logs JSON são enviados para stdout. A plataforma de containers deve aplicar coleta, acesso e retenção. Credenciais, Authorization e envelopes criptografados são redigidos pelo logger.

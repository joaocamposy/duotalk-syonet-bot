# Guia de Deploy e Produção

Orientações para colocar o serviço em produção.

## 1. Deploy via Docker (Recomendado)

O projeto possui um `Dockerfile` multi-stage baseado na imagem oficial do Playwright (`mcr.microsoft.com/playwright:v1.50.0-noble`), garantindo a presença de todas as dependências gráficas e navegadores necessários.

```bash
docker compose up --build -d
```

## 2. Variáveis de Ambiente Críticas

- `NODE_ENV=production`
- `HEADLESS=true`
- `QUEUE_DRIVER=file` (ou `redis` se houver infraestrutura Redis disponível)
- `LOG_RETENTION_DAYS=7` (Define a retenção de logs para o auto-purge)

## 3. Retenção de Logs & Auto-Purge

O módulo `src/utils/log-purger.ts` executa um purger diário que remove automaticamente:
- Logs `.log` em `logs/` com mtime superior a `LOG_RETENTION_DAYS`.
- Screenshots `.png` de erros com mtime superior a `LOG_RETENTION_DAYS`.

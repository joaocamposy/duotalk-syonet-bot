# Especificação do Payload do Webhook Duotalk

Documentação técnica do formato de payload enviado pelo Duotalk para a API.

## Endpoint

- **URL**: `POST /webhook/duotalk`
- **Content-Type**: `application/json`
- **Authorization**: `Bearer <token do consumidor>` compartilhado pelo responsável pelo microsserviço

O Bearer autoriza o uso do microsserviço e não contém o login do Syonet. As credenciais são enviadas separadamente no corpo, por HTTPS, e criptografadas antes de entrar na fila.

## Exemplo de JSON

```json
{
  "credentials": {
    "url": "https://seu-tenant.syonet.com",
    "username": "usuario-tecnico",
    "password": "senha"
  },
  "target": {
    "companyId": 25
  },
  "data": {
    "id": "6a79aed2***",
    "idConversa": "6a79aed244f***",
    "origem": "Outbound",
    "canal": "WhatsApp 360",
    "qualificacaoLead": "Lead",
    "intermediario": "Duotalk",
    "operador": "Operador Exemplo",
    "nome": "Cliente Exemplo",
    "telefone": "5561999998888",
    "email": "cliente@example.com",
    "mensagem": "Mensagem: Conversa criada manualmente \n",
    "messageHistory": "Mensagem: Conversa criada manualmente \n",
    "url_duotalk": "Inicie a conversa: https://app.duotalk.io/apps/inbox/start-conversation?name=Cliente%20Exemplo&phone=5561999998888",
    "firstMessage": "",
    "intencao": "DVNU - Veículos Novos"
  }
}
```

## Regras de Validação Zod

- `credentials.url` (Obrigatória, URL HTTPS do tenant Syonet)
- `credentials.username` (Obrigatório)
- `credentials.password` (Obrigatória)
- `target.companyId` (Obrigatório; empresa Syonet esperada para a sessão. É metadado do consumidor, não campo do Duotalk)
- `nome` (Obrigatório, min 1 caractere)
- `telefone` (Obrigatório; DDD + 8/9 dígitos, com DDI brasileiro `55` opcional). Exemplo: `5561993355555`.
- `email` (Opcional, formato de email)
- `intencao` (Opcional, ex: "DVNU - Veículos Novos")
- `operador` (Opcional, ex: "Jessica Helaine")
- `firstMessage` (Opcional; primeira mensagem da conversa, limitada a 10.000 caracteres)
- `dryRun` (Opcional; quando `true`, autentica, pesquisa e valida os de/para sem executar `POST` no Syonet)

`mensagem`, `firstMessage`, `messageHistory` e `url_duotalk` compõem a observação da oportunidade. O serviço aceita até 50.000 caracteres de histórico, mas retém somente os primeiros 8.000, limite aproveitável pela observação. Parâmetros sensíveis conhecidos em URLs são substituídos por `[REDACTED]` antes da persistência.

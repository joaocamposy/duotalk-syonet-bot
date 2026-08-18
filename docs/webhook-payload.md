# Especificação do Payload do Webhook Duotalk

Documentação técnica do formato de payload enviado pelo Duotalk / n8n para a API.

## Endpoint

- **URL**: `POST /webhook/duotalk`
- **Content-Type**: `application/json`
- **Authorization**: `Bearer <token do consumidor>` compartilhado pelo responsável pelo microsserviço

O Bearer autoriza o uso do microsserviço e não contém o login do Syonet. As credenciais são enviadas separadamente no corpo, por HTTPS, e criptografadas antes de entrar na fila.

## Exemplo de JSON

```json
{
  "method": "POST",
  "url": "https://webhook.example.com/duotalk",
  "headers": {
    "Content-Type": "application/json"
  },
  "credentials": {
    "url": "https://seu-tenant.syonet.com",
    "username": "usuario-tecnico",
    "password": "senha",
    "version": "1"
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
    "nomeChatbot": "Geely",
    "tipoIntegracao": "abertura",
    "triggerType": 1,
    "operador": "Operador Exemplo",
    "operadorId": "6a4c0f8062154***",
    "operadorEmail": "operador@example.com",
    "nome": "Cliente Exemplo",
    "telefone": "5561999998888",
    "email": "cliente@example.com",
    "mensagem": "Mensagem: Conversa criada manualmente \n",
    "messageHistory": "Mensagem: Conversa criada manualmente \n",
    "integrationIdValue": null,
    "integrationEmailValue": null,
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
- `credentials.version` (Opcional; pode mudar para forçar a invalidação lógica do cache)
- `target.companyId` (Obrigatório; empresa Syonet esperada para a sessão. É metadado do consumidor, não campo do Duotalk)
- `nome` (Obrigatório, min 1 caractere)
- `telefone` (Obrigatório; DDD + 8/9 dígitos, com DDI brasileiro `55` opcional). Exemplo: `5561993355555`.
- `email` (Opcional, formato de email)
- `intencao` (Opcional, ex: "DVNU - Veículos Novos")
- `operador` (Opcional, ex: "Jessica Helaine")
- `firstMessage` (Opcional; primeira mensagem da conversa, limitada a 10.000 caracteres)
- `dryRun` (Opcional; quando `true`, autentica, pesquisa e valida os de/para sem executar `POST` no Syonet)

O Duotalk pode continuar enviando os demais campos do payload de referência. Como eles não participam da integração atual, `nomeChatbot`, `tipoIntegracao`, `triggerType`, `operadorId`, `operadorEmail`, `integrationIdValue` e `integrationEmailValue` são aceitos como propriedades adicionais, mas descartados durante a validação e não entram na fila nem no Syonet.

`mensagem`, `firstMessage`, `messageHistory` e `url_duotalk` compõem a observação da oportunidade. O serviço aceita até 50.000 caracteres de histórico, mas retém somente os primeiros 8.000, limite aproveitável pela observação. Parâmetros sensíveis conhecidos em URLs são substituídos por `[REDACTED]` antes da persistência.

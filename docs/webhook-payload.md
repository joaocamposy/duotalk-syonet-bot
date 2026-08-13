# Especificação do Payload do Webhook Duotalk

Documentação técnica do formato de payload enviado pelo Duotalk / n8n para a API.

## Endpoint
- **URL**: `POST /webhook/duotalk`
- **Content-Type**: `application/json`

## Exemplo de JSON

```json
{
  "method": "POST",
  "url": "https://n8n.jorlan.sandbox-duotalk.com///67cbebc9-f25e-4ee3-8601-603e85b97d95",
  "headers": {
    "Content-Type": "application/json"
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
    "operador": "Jessica Helaine",
    "operadorId": "6a4c0f8062154***",
    "operadorEmail": "jessicahelaine@email.com",
    "nome": "Vilmar Medeiros",
    "telefone": "5561993355555",
    "email": "5561993355555@emailduotalk.com",
    "mensagem": "Mensagem: Conversa criada manualmente \n",
    "messageHistory": "Mensagem: Conversa criada manualmente \n",
    "integrationIdValue": null,
    "integrationEmailValue": null,
    "url_duotalk": "Inicie a conversa: https://app.duotalk.io/apps/inbox/start-conversation?name=Vilmar%20Medeiros&phone=5561993351327",
    "firstMessage": "",
    "intencao": "DVNU - Veículos Novos"
  }
}
```

## Regras de Validação Zod

- `nome` (Obrigatório, min 1 caractere)
- `telefone` (Obrigatório, min 8 dígitos). Exemplo: `5561993355555`.
- `email` (Opcional, formato de email)
- `intencao` (Opcional, ex: "DVNU - Veículos Novos")
- `operador` (Opcional, ex: "Jessica Helaine")

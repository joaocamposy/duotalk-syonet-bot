# Uso da API

Guia operacional para sistemas que enviam leads à integração Duotalk → Syonet.

O contrato oficial de campos, formatos, exemplos e respostas é o [OpenAPI](openapi.json). Em desenvolvimento, ele também está disponível em `/docs/json`, com interface Swagger em `/docs`.

## Autorização

O responsável pelo deploy fornece o `API_TOKEN`. Envie-o em todas as rotas protegidas:

```http
Authorization: Bearer <API_TOKEN>
```

Esse token autoriza o consumo da API e não contém o login do Syonet.

## Envio

Use `POST /leads`. Cada requisição contém:

- `credentials`: URL HTTPS, usuário e senha do ambiente Syonet;
- `target.companyId`: unidade esperada para a sessão;
- `dryRun`: controle opcional de homologação, fora de `data`;
- `daysToUpdateOpenEvent`: janela opcional para reutilizar uma oportunidade aberta;
- `data`: payload do lead conforme o OpenAPI.

Exemplo mínimo de homologação:

```bash
curl --request POST 'https://api.example.com/leads' \
  --header 'Authorization: Bearer SEU_TOKEN' \
  --header 'Content-Type: application/json' \
  --data '{
    "credentials": {
      "url": "https://tenant.syonet.com",
      "username": "usuario-do-syonet",
      "password": "senha-do-syonet"
    },
    "target": { "companyId": 25 },
    "dryRun": true,
    "daysToUpdateOpenEvent": 30,
    "data": {
      "idConversa": "conversa-a1b2c3",
      "nome": "Teste Duotalk a1b2c3",
      "telefone": "5561999998888",
      "canal": "WhatsApp 360",
      "intermediario": "Duotalk",
      "intencao": "DVNU - Veículos Novos"
    }
  }'
```

`dryRun: true` autentica, valida a unidade, pesquisa o cliente e resolve os de/para sem executar `POST` ou `PATCH` no Syonet. Gravações reais exigem uma `idConversa` estável.

Quando `daysToUpdateOpenEvent` é maior que zero, a integração procura a oportunidade aberta mais recente do mesmo cliente, empresa, grupo e tipo dentro da janela informada. Se encontrar, adiciona a nova observação como comentário e não cria outra oportunidade. O valor `0` ou a ausência do campo preserva o comportamento padrão de criar uma oportunidade para cada nova conversa.

## Modos de processamento

Sem `sync`, o processamento é síncrono. Com a fila habilitada, `?sync=false` aceita o lead para processamento em segundo plano e devolve um `jobId`.

| Situação                                      | Resposta                          |
| --------------------------------------------- | --------------------------------- |
| Processamento concluído                       | `200` com `result`                |
| Job aceito em segundo plano                   | `202` com `jobId`                 |
| Prazo síncrono esgotado                       | `504` com `jobId`; o job continua |
| Fila desabilitada com `sync=false`            | `503`, sem criar job              |
| Fila habilitada sem processador ou capacidade | `503`, sem criar job              |

Consulte um job com `GET /queue/jobs/{jobId}`. O resultado informa se o cliente foi criado ou atualizado e se a oportunidade foi criada ou reutilizada. O formato completo está no OpenAPI.

## Idempotência

- A mesma `idConversa` pode atualizar o contato, mas reutiliza a oportunidade existente, mesmo se o tipo de evento mudar.
- Com `daysToUpdateOpenEvent > 0`, conversas diferentes também podem reutilizar uma oportunidade aberta compatível; cada nova observação é registrada como comentário.
- `dryRun` e gravação possuem escopos independentes.
- Reenvios idênticos em fila reutilizam o job existente.
- Um `409` indica repetição de uma falha que exige conciliação; não crie um novo identificador para contornar o bloqueio.
- Após um `504`, consulte o `jobId` antes de considerar qualquer reenvio.

## Tratamento de respostas

| HTTP  | Ação do consumidor                                                        |
| ----- | ------------------------------------------------------------------------- |
| `400` | Corrigir o payload conforme o OpenAPI.                                    |
| `401` | Corrigir o Bearer da API.                                                 |
| `404` | Verificar se o `jobId` existe e ainda está dentro do período de retenção. |
| `409` | Conciliar a falha anterior antes de reenviar.                             |
| `422` | Corrigir credencial, unidade ou de/para indicado por `errorCode`.         |
| `429` | Respeitar o limite de tráfego e aplicar atraso.                           |
| `500` | Registrar o código, quando presente, e não repetir cegamente.             |
| `503` | Aplicar atraso exponencial; o lead não foi aceito quando não há `jobId`.  |
| `504` | Consultar o job; não reenviar imediatamente.                              |

### Códigos estáveis

| Código                                  | Significado                                            |
| --------------------------------------- | ------------------------------------------------------ |
| `SYONET_AUTHENTICATION_FAILED`          | Login ou sessão recusados.                             |
| `SYONET_COMPANY_ACCESS_DENIED`          | Empresa ativa diferente de `target.companyId`.         |
| `SYONET_CONTACT_FORM_MAPPING_NOT_FOUND` | Forma de contato sem de/para.                          |
| `SYONET_EVENT_TYPE_MAPPING_NOT_FOUND`   | Tipo de evento sem de/para.                            |
| `SYONET_MEDIA_MAPPING_NOT_FOUND`        | Mídia sem de/para.                                     |
| `SYONET_DATA_CONFLICT`                  | Pesquisa ambígua ou inconclusiva.                      |
| `SYONET_CONTRACT_INVALID`               | Resposta incompatível com o contrato esperado.         |
| `SYONET_WRITE_REJECTED`                 | Escrita recusada pelo Syonet.                          |
| `SYONET_WRITE_REQUIRES_RECONCILIATION`  | Escrita possivelmente aplicada sem confirmação segura. |

## Credenciais e dados sensíveis

O sistema consumidor continua responsável por armazenar e selecionar as credenciais do Syonet. Recupere-as somente no momento da chamada e não registre o corpo, a senha ou o cabeçalho `Authorization`.

No modo direto, as credenciais permanecem somente em memória. Com fila habilitada, são cifradas antes da persistência e removidas quando o job termina. A consulta pública do job não devolve credenciais, payload pessoal ou erro bruto.

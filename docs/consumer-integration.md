# Guia de integração para sistemas consumidores

Este microsserviço recebe um lead e as credenciais do tenant Syonet na mesma requisição. O sistema consumidor continua responsável por armazenar, selecionar e rotacionar essas credenciais.

Cada chamada pode informar uma URL e um login diferentes. Não existe URL, usuário ou senha padrão do Syonet no ambiente deste serviço.

O deploy mantém apenas `SYONET_ALLOWED_HOSTS`, uma cerca de segurança com os hosts exatos que podem ser acessados. Ela não seleciona cliente nem armazena credenciais. Curingas, IPs, portas, URLs completas e destinos fora da lista são rejeitados com `400`.

## Autorização

O responsável pelo deploy fornece ao time consumidor o valor de `MICROSERVICE_API_TOKEN`. Envie-o em todas as chamadas protegidas:

```http
Authorization: Bearer <MICROSERVICE_API_TOKEN>
```

Esse token autoriza o consumo da API. Ele não é o usuário ou a senha do Syonet.

## Criar um lead

```bash
curl --request POST 'https://microservico.example.com/webhook/duotalk' \
  --header 'Authorization: Bearer SEU_TOKEN_DO_MICROSSERVICO' \
  --header 'Content-Type: application/json' \
  --data '{
    "credentials": {
      "url": "https://seu-tenant.syonet.com",
      "username": "usuario-do-syonet",
      "password": "senha-do-syonet",
      "version": "1"
    },
    "target": {
      "companyId": 25
    },
    "data": {
      "idConversa": "conversa-123",
      "nome": "Maria Silva",
      "telefone": "5561999999999",
      "email": "maria@example.com",
      "canal": "WhatsApp",
      "intermediario": "Duotalk",
      "intencao": "Veículos Novos"
    }
  }'
```

Resposta assíncrona:

```json
{
  "success": true,
  "message": "Lead recebido e enfileirado com sucesso para gravação no Syonet CRM",
  "jobId": "43c4f81d-50ef-46df-9386-e445de8b458d",
  "status": "pending"
}
```

Para uma homologação pontual, acrescente `?sync=true`. O serviço aguarda até `SYNC_TIMEOUT_MS`; se o processamento continuar, responde `202` e o job deve ser consultado normalmente. Em produção, prefira o fluxo assíncrono.

## Consultar o resultado

```bash
curl --header 'Authorization: Bearer SEU_TOKEN_DO_MICROSSERVICO' \
  'https://microservico.example.com/queue/jobs/43c4f81d-50ef-46df-9386-e445de8b458d'
```

Quando concluído, o objeto `result` contém `companyId`, `clientId`, `eventId`, informa se o cliente foi criado e apresenta em `mapping` os valores de forma de contato, grupo/tipo de evento e mídia efetivamente selecionados. A consulta pública do job não devolve o payload do lead, o destino, o erro bruto, usuário, senha ou envelope criptografado.

`target.companyId` não pertence ao payload Duotalk. O sistema consumidor deve obtê-lo junto da credencial selecionada e enviá-lo separadamente. O microsserviço compara esse valor com a empresa ativa da sessão antes de pesquisar ou gravar qualquer cliente.

Se a unidade não estiver disponível na sessão, o job termina com `errorCode: "SYONET_COMPANY_ACCESS_DENIED"`. Em `?sync=true`, essa condição retorna HTTP `422`; no modo assíncrono, consulte o job recebido no `202`.

Forma de contato, tipo de oportunidade e mídia também são validados antes do primeiro `POST`. Enquanto o de/para funcional não estiver fechado, valores sem correspondência terminam sem gravação com um destes códigos:

- `SYONET_CONTACT_FORM_MAPPING_NOT_FOUND`
- `SYONET_EVENT_TYPE_MAPPING_NOT_FOUND`
- `SYONET_MEDIA_MAPPING_NOT_FOUND`

Esses códigos também retornam `422` no modo síncrono. Eles indicam ajuste de configuração. Depois de corrigir a unidade ou o de/para, o mesmo identificador pode ser reenviado e gera um job novo.

Para homologar sem gravar, envie `dryRun: true`. O serviço executa todas as leituras, valida a unidade e todos os de/para e devolve o `mapping` selecionado, mas não chama nenhum endpoint `POST` do Syonet.

O modo `dryRun` possui um escopo de deduplicação separado da gravação. Portanto, o envio real posterior com o mesmo `idConversa` ou `id` não é confundido com a homologação.

No repositório, `npm run test:lead < payload.local.json` carrega o `.env` e aceita por padrão somente `data.dryRun: true`. Depois de conferir o resultado, uma gravação intencional pode ser liberada apenas para aquela execução com `ALLOW_WRITE_TEST=true npm run test:lead < payload.local.json`.

## Exemplo com JavaScript

```js
const response = await fetch('https://microservico.example.com/webhook/duotalk', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.MICROSERVICE_API_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    credentials: {
      url: syonet.url,
      username: syonet.username,
      password: syonet.password,
      version: syonet.version,
    },
    target: {
      companyId: syonet.companyId,
    },
    data: lead,
  }),
});

if (!response.ok) {
  throw new Error(`Falha ao enviar lead: HTTP ${response.status}`);
}

const job = await response.json();
```

## Regras de segurança para o consumidor

- Use somente o endpoint HTTPS publicado pelo microsserviço.
- Nunca registre o corpo completo da requisição ou o header `Authorization`.
- Recupere a senha do gerenciador oficial apenas no momento da chamada.
- Não grave a senha em tabelas de integração, filas secundárias ou mensagens de erro.
- `credentials.version` é opcional e pode ser alterado para forçar a invalidação lógica de uma sessão; mudanças de usuário ou senha já geram outra chave de cache.
- Configure timeout e retry somente para respostas em que a requisição comprovadamente não foi aceita.
- Trate `401` como token do microsserviço ausente ou incorreto.
- Trate `409` como repetição de um job já falho que exige conciliação antes de novo envio.
- Trate `422` como configuração incompatível. Use `errorCode` para distinguir unidade, forma de contato, tipo de evento ou mídia; não repita até corrigir o vínculo ou o de/para.
- Trate `400` como payload inválido.
- Trate `429` como limite de chamadas excedido e respeite o intervalo antes de tentar novamente.
- Trate `200` como lead processado e resultado disponível; o corpo contém `status: "completed"` e pode indicar `duplicate: true` quando o resultado já existia.
- Trate `202` como lead aceito para processamento em background. Preserve o `jobId` e consulte seu status.
- Trate `503` como indisponibilidade temporária ou backpressure da fila. O reenvio é seguro somente quando a resposta não trouxe `jobId`; aplique atraso exponencial.

## Responsabilidades deste microsserviço

Depois de validar a requisição, o serviço cifra `credentials` com AES-256-GCM antes de persistir o job. Somente o worker descriptografa o conteúdo. A chave usada para isso pertence ao deploy deste microsserviço e não substitui o gerenciador de credenciais do sistema consumidor.

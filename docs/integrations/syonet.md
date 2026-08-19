# Integração HTTP com o Syonet CRM

O serviço usa as mesmas rotas HTTP consumidas pelo portal oficial do Syonet. Não há navegador ou automação de DOM no fluxo.

## Proteção das credenciais

1. `Authorization: Bearer` autentica o sistema que consome o microsserviço.
2. O objeto `credentials` traz URL, usuário e senha do Syonet por uma conexão HTTPS.
3. O controller valida os valores e os cifra imediatamente com AES-256-GCM.
4. A fila persiste as credenciais somente como IV, texto cifrado e tag de autenticação. Enquanto o job está pendente, os dados do lead permanecem no arquivo protegido por modo `0600` e pela criptografia do volume.
5. O worker descriptografa o envelope em memória e executa o login. A fila remove o envelope e o payload pessoal quando o job termina, com sucesso ou falha definitiva.

O consumidor também envia `target.companyId`, fora do objeto `data`. Imediatamente após o login, o serviço consulta `/api/sessao/empresa`. Se a empresa ativa for diferente, encerra o job com `SYONET_COMPANY_ACCESS_DENIED` antes de pesquisar ou gravar dados.

Objeto recebido:

```json
{
  "url": "https://crm.example.com",
  "username": "usuario-tecnico",
  "password": "senha"
}
```

A chave `CREDENTIAL_ENCRYPTION_KEY` protege somente o trânsito temporário pela fila; ela não substitui o gerenciamento das credenciais feito pelo sistema consumidor.

## Autenticação

1. `GET /portal/app.do?modulo=login` inicia a sessão e fornece `JSESSIONID`.
2. `GET /api/parametro/PUB_PEM` obtém a chave pública do tenant.
3. Usuário e senha são criptografados com RSA-OAEP/SHA-1.
4. `POST /portal/validarLogonUsuario.do?opcaoAtualizacao` autentica e devolve os cookies.
5. `GET /api/sessao/usuario` confirma que a sessão está válida.

Os cookies ficam somente na memória. Uma resposta `401`, `403` ou redirect inesperado renova a sessão uma vez somente em leituras. Nenhum `POST` ou `PATCH` de escrita no CRM é repetido automaticamente, inclusive após rejeição de autenticação, timeout, falha de rede, redirect ou resposta inválida; o resultado exige conciliação conservadora. O `POST` de login, que não cria registros, pode ser repetido após falha transitória do servidor.

Todas as chamadas usam `SYONET_HTTP_TIMEOUT_MS`. Redirecionamentos inesperados em leituras provocam uma renovação da sessão; depois de uma escrita, são tratados como resultado ambíguo e não são repetidos. As respostas são validadas antes de seus IDs ou metadados serem usados.

## Processamento do lead

1. Valida a empresa ativa da sessão contra `target.companyId`.
2. Pesquisa o cliente por telefone em `GET /api/cliente` e exige correspondência exata no cadastro retornado.
3. Quando encontra o cliente, abre o cadastro completo em `GET /api/cliente/{idCliente}` e compara nome, email e telefone celular com o payload recebido.
4. Consulta usuário, formas de contato, tipos de evento e mídias permitidas antes de qualquer escrita.
5. Se o cliente não existir, cria em `POST /api/cliente` com o formato nativo do Syonet.
6. Se o cliente existir e houver diferença, envia somente os campos alterados em `PATCH /api/cliente/{idCliente}`.
7. Resolve forma de contato, tipo de oportunidade e mídia pelas regras centralizadas em `src/integrations/syonet/mapping-config.ts`.
8. Para um cliente existente e com `idConversa`, consulta as oportunidades do mesmo cliente, empresa e tipo de evento. Se a observação já contiver exatamente esse identificador de conversa, reutiliza o evento encontrado; caso contrário, cria a oportunidade em `POST /api/evento`.
9. Retorna `companyId`, `idCliente`, `idEvento` e informa em `eventCreated` se uma nova oportunidade foi criada.

O payload recebido é considerado a fonte mais recente para nome, email informado e telefone celular. Campos sem valor no payload não apagam dados existentes. Comparações de nome ignoram diferenças apenas de caixa e espaços; comparações de email também ignoram caixa. Com `dryRun: true`, o serviço autentica, pesquisa e abre o cliente, consulta as opções do tenant e valida todo o de/para, mas não executa `POST` nem `PATCH`. O resultado informa em `mapping` a forma de contato, o grupo/tipo de evento e a mídia que seriam usados.

O cadastro envia ao Syonet somente os dados disponíveis no payload de referência do Duotalk e usa `validateFields: false` para permitir o cadastro parcial.

Os de/para atuais são provisórios e deliberadamente conservadores. A forma de contato tenta `canal`, depois `origem` e somente aliases declarados; o tipo de evento usa `qualificacaoLead` e `intencao`; a mídia usa `intermediario`. Não existe fallback silencioso. Se o Syonet não oferecer uma opção confirmada, o fluxo falha antes de criar cliente ou oportunidade. Na validação funcional, somente o arquivo de configuração de mapeamentos deve ser alterado.

Textos usados na observação do evento são limitados e URLs têm parâmetros sensíveis conhecidos, como `token` e `access_token`, redigidos antes da fila e novamente antes do envio ao CRM.

## Duplicação de oportunidades

`idConversa` é a identidade da ocorrência comercial. Reenvios da mesma conversa podem atualizar os dados do cliente, mas não criam outra oportunidade. Uma conversa diferente do mesmo telefone continua autorizada a criar uma nova oportunidade.

A consulta considera o cliente, a empresa e o tipo de evento e confirma o identificador pela linha `ID conversa: ...` gravada na observação. A data do Syonet não compõe a identidade: o payload de origem não possui uma data estruturada do evento e `dataProximaAcao` é calculada por esta integração. Usá-la como chave faria um reenvio em outro dia escapar da proteção. Se mais de uma oportunidade já possuir o mesmo identificador, o processamento falha sem criar outra e exige conciliação.

Uma falha de rede após iniciar `POST /api/cliente`, `PATCH /api/cliente/{idCliente}` ou `POST /api/evento` é considerada ambígua. O job não é repetido automaticamente, evitando duplicação ou sobreposição incerta; ele deve ser conciliado usando os dados do CRM e o identificador da conversa.

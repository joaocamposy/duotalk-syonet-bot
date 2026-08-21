# Integração HTTP com o Syonet CRM

O serviço usa as mesmas rotas HTTP consumidas pelo portal oficial do Syonet. Não há navegador ou automação de DOM no fluxo.

## Proteção das credenciais

1. `Authorization: Bearer` autentica o sistema que consome a API.
2. O objeto `credentials` traz URL, usuário e senha do Syonet por uma conexão HTTPS.
3. No fluxo direto, o controlador mantém os valores somente em memória durante a chamada.
4. Quando a fila está habilitada, o controlador cifra os valores com AES-256-GCM. A fila persiste somente IV, texto cifrado e tag de autenticação para as credenciais.
5. O processador descriptografa o envelope em memória e executa o login. Credenciais e dados pessoais são removidos quando o job termina.

O consumidor também envia `target.companyId`, fora do objeto `data`. Imediatamente após o login, o serviço consulta `/api/sessao/empresa`. Se a empresa ativa for diferente, encerra o job com `SYONET_COMPANY_ACCESS_DENIED` antes de pesquisar ou gravar dados.

A chave `CREDENTIAL_ENCRYPTION_KEY` protege somente o trânsito temporário pela fila; ela não substitui o gerenciamento das credenciais feito pelo sistema consumidor.

## Autenticação

1. `GET /portal/app.do?modulo=login` inicia a sessão e fornece `JSESSIONID`.
2. `GET /api/parametro/PUB_PEM` obtém a chave pública do tenant.
3. Usuário e senha são criptografados com RSA-OAEP/SHA-1.
4. `POST /portal/validarLogonUsuario.do?opcaoAtualizacao` autentica e devolve os cookies.
5. `GET /api/sessao/usuario` confirma que a sessão está válida.

Os cookies ficam somente na memória. Em leituras, uma resposta `401`, `403` ou um redirecionamento inesperado renova a sessão uma única vez. Escritas nunca são repetidas automaticamente depois de rejeição de autenticação, tempo limite, falha de rede, redirecionamento ou resposta inválida. No processamento em fila, o login — que não cria registros no CRM — pode ser repetido após uma falha transitória do servidor.

Cada chamada respeita `SYONET_HTTP_TIMEOUT_MS`, cada corpo JSON é limitado por `SYONET_HTTP_MAX_RESPONSE_BYTES`, e o fluxo completo respeita `SYONET_PROCESS_TIMEOUT_MS`. As respostas são validadas antes do uso de seus identificadores ou metadados.

## Processamento do lead

1. Valida a empresa ativa da sessão contra `target.companyId`.
2. Pesquisa o cliente por telefone em `GET /api/cliente` e exige correspondência exata no cadastro retornado.
3. Quando encontra o cliente, abre o cadastro completo em `GET /api/cliente/{idCliente}` e compara nome, email e telefone celular com o payload recebido.
4. Consulta usuário, formas de contato, tipos de evento e mídias permitidas antes de qualquer escrita.
5. Se o cliente não existir, cria em `POST /api/cliente` com o formato nativo do Syonet.
6. Se o cliente existir e houver diferença, envia somente os campos alterados em `PATCH /api/cliente/{idCliente}`.
7. Resolve forma de contato, tipo de oportunidade e mídia pelas regras centralizadas em `src/integrations/syonet/mapping-config.ts`.
8. Para um cliente existente, consulta as oportunidades do mesmo cliente e empresa, independentemente do tipo atual. Se o cabeçalho técnico da observação corresponder à `idConversa`, reutiliza o evento encontrado.
9. Quando `daysToUpdateOpenEvent` é maior que zero e a conversa ainda não foi localizada, procura uma oportunidade aberta do mesmo cliente, empresa, grupo e tipo dentro da janela. Se encontrar, inclui a nova observação em `POST /api/evento/{idEvento}/acao` como comentário.
10. Cria a oportunidade em `POST /api/evento` somente quando nenhuma regra encontra um evento reutilizável.
11. Retorna `companyId`, `clientId`, `eventId` e informa em `eventCreated` se uma nova oportunidade foi criada.

O payload recebido é considerado a fonte mais recente para nome, email informado e telefone celular. Campos ausentes não apagam dados existentes. As comparações de nome e email ignoram diferenças de caixa; a comparação de nome também normaliza espaços. Com `dryRun: true`, o serviço autentica, pesquisa e abre o cliente, consulta as opções do ambiente e valida todo o de/para, mas não executa `POST` nem `PATCH`. O resultado informa em `mapping` os valores que seriam usados.

O cadastro envia ao Syonet somente os dados disponíveis no payload de referência do Duotalk e usa `validateFields: false` para permitir o cadastro parcial.

Os de/para atuais são provisórios e deliberadamente conservadores. A forma de contato tenta `canal`, depois `origem` e somente equivalências declaradas; o tipo de evento usa `qualificacaoLead` e `intencao`; a mídia usa `intermediario`. Não existe alternativa implícita. Se o Syonet não oferecer uma opção confirmada, o fluxo falha antes de criar cliente ou oportunidade. Na validação funcional, somente o arquivo de configuração de mapeamentos deve ser alterado.

Textos usados na observação do evento são limitados e URLs têm parâmetros sensíveis conhecidos, como `token` e `access_token`, redigidos antes da fila e novamente antes do envio ao CRM.

## Duplicação de oportunidades

`idConversa` é a identidade obrigatória da ocorrência comercial em gravações. Reenvios da mesma conversa podem atualizar os dados do cliente, mas não criam outra oportunidade.

A consulta considera o cliente e a empresa e confirma o identificador por um marcador SHA-256 no cabeçalho reservado da observação. Para compatibilidade, também reconhece o cabeçalho legado criado por esta integração, mas nunca procura o marcador em mensagens ou histórico. O tipo de evento e a data não compõem a identidade: ambos podem mudar entre reenvios, e `dataProximaAcao` é calculada pela integração. Se mais de uma oportunidade já possuir o mesmo identificador, o processamento falha sem criar outra e exige conciliação.

Se a pesquisa atingir o limite de 200 oportunidades sem localizar a conversa, o serviço também falha de forma conservadora com `SYONET_DATA_CONFLICT`. Ele não cria um novo evento enquanto não puder provar que a conversa está ausente.

Por padrão, uma conversa diferente continua autorizada a criar outra oportunidade. Com `daysToUpdateOpenEvent > 0`, a integração procura eventos com status `ANDAMENTO`, `AGUARDANDO` ou `PENDENTE`, do mesmo cliente, empresa, grupo e tipo, e considera somente os criados dentro da quantidade de dias informada. Escolhe o mais recente e adiciona a nova observação como comentário. O valor `0` ou a ausência do campo desativa essa regra.

O comentário recebe o mesmo marcador técnico da conversa. Antes de adicioná-lo, a integração consulta as ações do evento e evita registrar novamente uma conversa já processada.

Uma falha de rede após iniciar `POST /api/cliente`, `PATCH /api/cliente/{idCliente}`, `POST /api/evento` ou `POST /api/evento/{idEvento}/acao` é considerada ambígua. A operação não é repetida automaticamente, evitando duplicação ou sobreposição incerta. O resultado deve ser conciliado no CRM usando o identificador da conversa.

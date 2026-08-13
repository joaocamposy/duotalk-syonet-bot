# Automação Syonet CRM com Playwright

Documentação técnica do fluxo de navegação automatizada no painel do Syonet.

## Arquitetura de Interface do Syonet CRM

O Syonet CRM utiliza uma arquitetura híbrida:
- **Shell Principal**: SPA React/MUI (Login em `#login` / `#password`).
- **Conteúdo Operacional**: Iframe legado AngularJS com `name="home"` e `id="legacy-app"` rodando em `#/cic.do`.

Todas as operações de formulários, buscas e cadastros ocorrem exclusivamente **dentro do contexto deste iframe**.

## Fluxo de Automação (`src/crawler/`)

1. **Autenticação & Sessão (`auth.ts`)**:
   - Tenta abrir o painel `https://crm.grupoab.com.br/portal/acessaSistema.do`.
   - Se a sessão expirou ou não há cookies em `data/storage_state.json`, realiza login via `#login` / `#password` e `button.MuiButton-containedPrimary`.

2. **Pesquisa Prévia & Cadastro (`contacts.ts`)**:
   - Acessa o iframe `name="home"`.
   - Clica no botão **"Pesquisar clientes"** (`a:has-text("Pesquisar clientes")`).
   - Seleciona a opção de busca por **Telefone** via label `label[for="eventowizard-search-option-tel"]` (pois os inputs radio são ocultos via CSS).
   - Digita DDD + Número no input `input[placeholder="Pesquisar clientes..."]` (ex: `61999990001`).
   - **CENÁRIO A (Sem Resultados)**:
     - Detecta a mensagem `"Nenhum cliente encontrado"`.
     - Clica em **"Criar cliente"**.
     - Preenche Nome (`#eventowizard-cliente-nome`), E-mail (`#eventowizard-cliente-email`), CPF (`#eventowizard-cliente-cpfcnpj`), Origem (`#eventowizard-cliente-origem`) e os campos de Endereço Comercial obrigatórios.
     - Clica em **"Criar cliente"** (`button.syo-success`).
   - **CENÁRIO B (Com Resultados)**:
     - Clica no primeiro registro retornado na lista do wizard para vincular a oportunidade.

3. **Execução de Teste Manual / Visual**:
   - Para rodar a automação visualmente com navegador aberto:
     ```bash
     npm run test:lead
     ```

## Screenshots & Log Retention
- Screenshots de erro são salvas automaticamente em `logs/screenshots/job-{jobId}-error.png`.
- Logs e screenshots têm auto-purge configurável via `LOG_RETENTION_DAYS`.


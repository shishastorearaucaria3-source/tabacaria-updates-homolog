# NossoSistema v1.0.1

Sistema completo de gerenciamento para tabacaria.

## Arquivos

| Arquivo | Tamanho | SHA256 |
|---------|---------|--------|
| `NossoSistema.exe` | 93.2 MB | `5F4527B7732CC7D1AEB508D1CA2BE7324A3F96F411AF756B6B0C24448F00CEF7` |
| `NossoSistema-Setup.exe` | 227.9 MB | `8506AE0D4BFA006E854C9885B47B2EE5D2F2D845810B7255A226D9B0842C1F33` |

## Instalacao

### Instalador (recomendado)
1. Execute `NossoSistema-Setup.exe`
2. Escolha a pasta de instalacao (padrao: `C:\NossoSistema`)
3. O sistema sera iniciado automaticamente
4. Dados ficam na pasta de instalacao
5. Na desinstalacao, e opcional remover os dados

### Portatil
1. Copie `NossoSistema.exe` para a pasta desejada
2. Execute direto — extrai e roda automaticamente
3. Dados ficam ao lado do executavel

## Requisitos
- Windows 10/11 (x64)
- Sem dependencias externas

## O que esta incluido

### NossoSistema
- PDV, vendas, cancelamentos, pedidos
- Cadastro de produtos, clientes, vendedores
- Controle de estoque com inventario
- Relatorios e comissoes
- Contas a pagar
- Caixa
- Catalogo online
- Formas de pagamento
- Alterar precos em lote
- Gerenciamento de usuarios
- **Atendimento WhatsApp** (painel administrativo completo)
  - Visao geral (dashboard)
  - Controle do bot (pausar/ativar)
  - Conversas (historico, assumir, devolver ao bot)
  - Intencoes (treinamento NLP)
  - Mensagens (templates personalizaveis)
  - Menu do WhatsApp (itens dinamicos)
  - Produtos (visibilidade no WhatsApp)
  - Entrega (configuracao de taxas e frete)
  - Configuracoes gerais
  - Backup/restore das configuracoes do WhatsApp

### Servidor (janela separada)
- Status online/offline
- Controle tecnico do servidor (iniciar/parar/reiniciar)
- Controle tecnico do WhatsApp (iniciar/parar/reiniciar)
- Backup e restauracao
- Diagnostico e correcao
- Logs
- Sincronizacao
- Atualizacoes (OTA)
- Gerenciamento de dados (zerar, importar)
- Chave de API da rede

### Integracao
- Integracao WhatsApp via extensao WA Web Plus
- Servidor local (porta 3210, rede local)
- Backup automatico a cada 4h

## Alteracoes desta versao

### v1.0.1

#### Correcoes
- **AppUserModelId**: corrigido crash na inicializacao — `BrowserWindow.setAppUserModelId` nao existe; trocado por `app.setAppUserModelId` (API correta do Electron)
- Separacao NossoSistema/Servidor na barra de tarefas agora funciona sem erros

#### Interface
- Removida secao "Servidor" do menu do NossoSistema
- Adicionado "Atendimento WhatsApp" no menu do NossoSistema
- Painel administrativo do WhatsApp integrado ao NossoSistema
- Controle tecnico do servidor permanece somente na janela Servidor
- Janelas NossoSistema e Servidor separadas na barra de tarefas

#### Arquitetura
- IPC/preload/API do WhatsApp integrados (servidorClient.whatsapp)
- Estrutura de dados centralizada em `src/shared/data-dir.ts`
- Portatil: dados ao lado do exe via `PORTABLE_EXECUTABLE_DIR` (NSIS SFX)
- Instalador: dados na pasta de instalacao
- Single-instance lock protegido para processo --servidor

#### Correcoes adicionais
- Tela branca do servidor corrigida (extraResources)
- Icone do servidor na bandeja (servidor.ico via extraResources)
- Minimizar para bandeja e restaurar com duplo clique
- Dados portateis nao vazam para %APPDATA%
- Log cria diretorio antes de escrever
- Launcher do setup: lock de instancia removido (race condition)

## Notas tecnicas
- Electron 43 + Express + SQLite (node:sqlite DatabaseSync)
- Schema com 40 migracoes + 2 migracoes WhatsApp
- Graceful shutdown (SIGTERM/SIGINT)
- Electron-vite (build do renderer)

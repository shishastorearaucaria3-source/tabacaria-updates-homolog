import { app, shell, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } from 'electron'
import { join, dirname, basename, resolve } from 'node:path'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { execSync, spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { registerDbHandlers } from './ipc'
import { servidorClient, getServidorUrl, configurarServidor, lerPortaGravada } from './servidor'
import { versaoAtual, verificarAtualizacao, instalarAtualizacao, getUpdateBaseUrl, setUpdateBaseUrl, tipoInstalacaoAtual } from './update'

const PRODUTO = 'NossoSistema'
const APP_ID = 'br.com.lojatabacaria.sistema'

let mainWindow: BrowserWindow | null = null
let bandeja: Tray | null = null
let janelaServidor: BrowserWindow | null = null
let modoServidor = false

// Captura qualquer erro de processo principal para o log e (em produção)
// mostra um aviso — senão o app "não abre" e ninguém sabe o motivo.
function registrarErroGlobal(): void {
  const erroFatal = (titulo: string, e: unknown): void => {
    const msg = e instanceof Error ? `${e.message}\n\n${e.stack ?? ''}` : String(e)
    gravarLogServidor(`${titulo}: ${msg}`)
    try {
      dialog.showMessageBoxSync(mainWindow ?? undefined!, {
        type: 'error',
        title: `${PRODUTO} — erro ao iniciar`,
        message: `${titulo}:\n\n${msg}\n\nRegistro: %APPDATA%\\sistema-loja-tabacaria\\servidor-inicio.log`
      })
    } catch { /* ignore */ }
  }
  process.on('uncaughtException', (e) => erroFatal('Erro inesperado', e))
  process.on('unhandledRejection', (e) => erroFatal('Erro inesperado (promessa)', e))
}

// Remove atalhos, autostart, registro e a pasta de instalação (via cmd
// destacado, pois não dá para apagar o próprio exe em execução).
function desinstalar(): void {
  try {
    // Mata somente processos deste executável (por caminho), nunca outras
    // instalações com o mesmo nome de arquivo.
    const ps = `$alvo='${resolve(process.execPath).replace(/'/g, "''")}';Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $alvo } | Stop-Process -Force`
    spawn('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'ignore', windowsHide: true })
  } catch { /* ignore */ }
  try {
    try {
      execSync(`reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${PRODUTO} Servidor" /f`, { windowsHide: true })
    } catch { /* ignore */ }
    const menu = join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', PRODUTO)
    if (existsSync(menu)) rmSync(menu, { recursive: true, force: true })
    const desktop = join(process.env.USERPROFILE || '.', 'Desktop')
    for (const nome of [`${PRODUTO}.lnk`, 'Servidor.lnk', 'Iniciar Servidor.lnk', 'Parar Servidor.lnk']) {
      const p = join(desktop, nome)
      if (existsSync(p)) rmSync(p, { force: true })
    }
  } catch { /* ignore */ }
  try {
    execSync(`reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_ID}" /f`, { windowsHide: true })
  } catch { /* ignore */ }
  try {
    const dir = dirname(resolve(process.execPath))
    if (dir && existsSync(dir)) {
      // Apaga a pasta via cmd destacado que espera o app sair (o exe em
      // execução trava os arquivos — o cmd dá tempo e apaga por cima).
      const bat = join(tmpdir(), `desinstalar-${Date.now()}.bat`)
      const linhas = [
        '@echo off',
        `timeout /t 5 /nobreak >nul`,
        `rmdir /s /q "${dir}"`,
        `del "%~f0"`
      ].join('\r\n')
      writeFileSync(bat, linhas, 'utf8')
      spawn('cmd.exe', ['/c', bat], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
      setTimeout(() => app.exit(0), 1500)
      return
    }
  } catch { /* ignore */ }
  app.exit(0)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  let timerMostrar: NodeJS.Timeout | null = null
  const mostrar = (): void => {
    if (timerMostrar) clearTimeout(timerMostrar)
    timerMostrar = null
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show()
      mainWindow.maximize()
    }
  }

  mainWindow.on('ready-to-show', mostrar)
  // Garante que a janela apareça mesmo se ready-to-show demorar/não disparar
  // (GPU/renderer lento em alguns PCs), senão o app parece "não abrir".
  timerMostrar = setTimeout(mostrar, 4000)

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function servidorRespondendo(): Promise<boolean> {
  return new Promise((resolve) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 1500)
    fetch(`${getServidorUrl()}/api/config`, { signal: ctrl.signal })
      .then(() => resolve(true))
      .catch(() => resolve(false))
      .finally(() => clearTimeout(timer))
  })
}

// No modo servidor a saúde deve ser checada na porta local, NUNCA no
// servidor.url (que pode ter ficado com um endereço remoto de uma
// configuração cliente anterior — senão o servidor inicia mas a checagem
// mira outro IP e o app fecha achando que não subiu).
function servidorLocalRespondendo(porta: number): Promise<boolean> {
  return new Promise((resolve) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 1500)
    fetch(`http://localhost:${porta}/api/config`, { signal: ctrl.signal })
      .then(() => resolve(true))
      .catch(() => resolve(false))
      .finally(() => clearTimeout(timer))
  })
}

async function caminhoServidor(): Promise<string | null> {
  const candidatos: string[] = []
  if (app.isPackaged) {
    // Empacotado: server roda in-process. Require de DENTRO do asar (Electron
    // resolve node_modules do asar; sharp nativo sai via app.asar.unpacked).
    candidatos.push(join(process.resourcesPath, 'app.asar', 'out', 'server', 'server', 'index.js'))
    candidatos.push(join(process.resourcesPath, 'app.asar.unpacked', 'out', 'server', 'server', 'index.js'))
  }
  candidatos.push(
    // Desenvolvimento: compilado pelo tsc ao lado do node_modules do projeto
    join(__dirname, '..', '..', 'server', 'server', 'index.js'),
    join(process.cwd(), 'out', 'server', 'server', 'index.js')
  )
  for (const c of candidatos) {
    if (existsSync(c)) return c
  }
  return null
}

function caminhoLogServidor(): string {
  return join(
    process.env.APPDATA || join(process.env.USERPROFILE || '.', 'AppData', 'Roaming'),
    'sistema-loja-tabacaria',
    'servidor-inicio.log'
  )
}

function gravarLogServidor(m: string): void {
  try {
    writeFileSync(caminhoLogServidor(), `${new Date().toISOString()} ${m}\n`, { flag: 'a' })
  } catch { /* ignore */ }
}

async function iniciarServidorSeNecessario(): Promise<boolean> {
  gravarLogServidor('verificando servidor...')
  const porta = lerPortaGravada() || 3210
  if (await servidorLocalRespondendo(porta)) {
    gravarLogServidor('já respondendo')
    return true
  }
  const caminho = await caminhoServidor()
  if (!caminho) {
    console.error('[sistema] Servidor não compilado. Rode: npm run build:servidor')
    gravarLogServidor('servidor não compilado/encontrado')
    return false
  }
  gravarLogServidor(`caminho: ${caminho}`)
  try {
    // O servidor só se auto-inicia quando é o entry point (require.main).
    // Aqui (in-process) chamamos a inicialização explicitamente.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const servidorMod = require(caminho) as {
      initDb: () => unknown
      getDb: () => unknown
      seed: (db: unknown) => void
      iniciarServidor: (porta?: number) => void
    }
    servidorMod.initDb()
    servidorMod.seed(servidorMod.getDb())
    servidorMod.iniciarServidor(porta)
    gravarLogServidor('servidor inicializado')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[sistema] Falha ao iniciar servidor in-process:', msg)
    gravarLogServidor(`ERRO iniciar servidor: ${msg}`)
    return false
  }
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if (await servidorLocalRespondendo(porta)) {
      gravarLogServidor('servidor respondendo')
      return true
    }
  }
  gravarLogServidor('tempo esgotado aguardando servidor')
  return false
}

// Inicia o servidor como PROCESSO SEPARADO (--servidor, com bandeja própria).
// Assim fechar o servidor derruba a conexão e o sistema volta ao login.
// Em desenvolvimento mantém o servidor in-process (electron-vite dev).
async function iniciarServidorExterno(): Promise<boolean> {
  if (!app.isPackaged) {
    gravarLogServidor('dev: servidor in-process')
    return iniciarServidorSeNecessario()
  }
  try {
    const cwd = dirname(resolve(process.execPath))
    const child = spawn(process.execPath, ['--servidor'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      cwd
    })
    child.unref()
    gravarLogServidor(`servidor externo lançado (pid ${child.pid ?? '?'})`)
  } catch (e) {
    gravarLogServidor(`ERRO spawn servidor: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if (await servidorLocalRespondendo(lerPortaGravada() || 3210)) {
      gravarLogServidor('servidor externo respondendo')
      return true
    }
  }
  gravarLogServidor('tempo esgotado aguardando servidor externo')
  return false
}

function urlRemota(url: string): boolean {
  return /^https?:\/\/(?!localhost\b|127\.0\.0\.1\b)\S+/.test(url)
}

async function verificarServidor(): Promise<void> {
  const url = getServidorUrl()
  if (await servidorRespondendo()) {
    console.log(`[sistema] Conectado ao servidor em ${url}`)
    return
  }
  if (urlRemota(url) || tipoInstalacaoAtual() === 'cliente') {
    // Instalação cliente: NUNCA sobe servidor local (senão abre um banco
    // vazio deste PC e confunde). O login oferece a conexão ("Outro (rede)").
    if (urlRemota(url)) {
      console.error(`[sistema] Servidor remoto indisponível em ${url}`)
      gravarLogServidor(`servidor remoto indisponível: ${url}`)
      dialog.showMessageBoxSync(mainWindow ?? undefined!, {
        type: 'error',
        title: 'Servidor não encontrado',
        message: `Não foi possível conectar ao servidor em:\n\n${url}\n\nVerifique se:\n• o computador servidor está ligado e com o "Servidor" aberto (ícone na bandeja);\n• o endereço está correto.\n\nVocê pode ajustar a conexão na tela de login, opção "Outro (rede)".`
      })
    } else {
      console.error('[sistema] Instalação cliente sem endereço de servidor configurado')
      gravarLogServidor('cliente sem endereço de servidor configurado')
      dialog.showMessageBoxSync(mainWindow ?? undefined!, {
        type: 'info',
        title: 'Conectar ao servidor',
        message: `Este computador foi instalado como CLIENTE (balcão).\n\nPara usar o sistema, conecte ao servidor da loja na tela de login:\n• escolha "Outro (rede)";\n• digite o IP do servidor (ex.: 192.168.0.117) e clique em "Conectar".\n\nO endereço fica salvo — na próxima vez abre direto.`
      })
    }
    return
  }
  const ok = await iniciarServidorExterno()
  if (!ok) {
    console.error(`[sistema] Não foi possível conectar ao servidor em ${url}`)
    dialog.showMessageBoxSync(mainWindow ?? undefined!, {
      type: 'error',
      title: 'Servidor indisponível',
      message: `Não foi possível iniciar/conectar ao servidor (${url}).` + '\n\nVerifique se a porta 3210 está livre e tente novamente.'
    })
  } else {
    console.log(`[sistema] Conectado ao servidor em ${url}`)
  }
}

function caminhoIconeServidor(): string {
  const candidatos = [
    join(process.resourcesPath, 'servidor.ico'),
    join(__dirname, '..', '..', '..', 'build', 'icones', 'servidor.png'),
    join(process.cwd(), 'build', 'icones', 'servidor.png')
  ]
  for (const c of candidatos) {
    if (existsSync(c)) return c
  }
  return ''
}

function caminhoPainelServidor(): { html: string; preload: string } {
  if (app.isPackaged) {
    return {
      html: join(process.resourcesPath, 'servidor-panel', 'index.html'),
      preload: join(process.resourcesPath, 'servidor-panel', 'preload.js')
    }
  }
  return {
    html: join(process.cwd(), 'src', 'panel-servidor', 'index.html'),
    preload: join(process.cwd(), 'src', 'panel-servidor', 'preload.js')
  }
}

function criarJanelaServidor(): void {
  if (janelaServidor) {
    janelaServidor.show()
    janelaServidor.focus()
    return
  }
  const painel = caminhoPainelServidor()
  janelaServidor = new BrowserWindow({
    width: 920,
    height: 700,
    minWidth: 720,
    minHeight: 560,
    title: 'Servidor do Sistema',
    autoHideMenuBar: true,
    show: true,
    icon: criarIconeServidor(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: painel.preload
    }
  })
  janelaServidor.on('ready-to-show', () => janelaServidor?.show())
  janelaServidor.on('closed', () => {
    janelaServidor = null
  })
  janelaServidor.loadFile(painel.html, { query: { porta: String(lerPortaGravada() || 3210) } })
}

function criarIconeServidor(): Electron.NativeImage {
  const caminho = caminhoIconeServidor()
  if (caminho) {
    const img = nativeImage.createFromPath(caminho)
    if (!img.isEmpty()) return img
  }
  const svg = Buffer.from(
    `<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg"><rect width="32" height="32" rx="7" fill="#1d4ed8"/><rect x="6" y="6" width="20" height="8" rx="2" fill="#0f172a"/><rect x="6" y="18" width="20" height="8" rx="2" fill="#0f172a"/><circle cx="9" cy="10" r="1.6" fill="#22c55e"/><circle cx="13" cy="10" r="1.6" fill="#f59e0b"/><circle cx="9" cy="22" r="1.6" fill="#22c55e"/><circle cx="13" cy="22" r="1.6" fill="#f59e0b"/></svg>`
  )
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${svg.toString('base64')}`)
}

function registrarIpc(): void {
  registerDbHandlers()
  ipcMain.handle('backup:manual', async () => {
    const res = await servidorClient.backup()
    return { ok: res.ok, arquivo: res.ok ? `Backup salvo no servidor: ${res.arquivo}` : `Falha no backup: ${res.arquivo}` }
  })
  ipcMain.handle('servidor:info', () => ({ url: getServidorUrl() }))
  ipcMain.handle('app:versao', () => versaoAtual())
  ipcMain.handle('update:verificar', () => verificarAtualizacao())
  ipcMain.handle('update:instalar', () => instalarAtualizacao())
  ipcMain.handle('update:getConfig', () => getUpdateBaseUrl())
  ipcMain.handle('update:setConfig', (_e, url: string) => setUpdateBaseUrl(String(url ?? '')))
  ipcMain.handle('janela:fullscreen', (_e, ativo: boolean) => {
    if (mainWindow) mainWindow.setFullScreen(!!ativo)
  })
  ipcMain.on('janela:minimizar', () => {
    janelaServidor?.minimize()
  })
  ipcMain.on('janela:fechar', () => {
    janelaServidor?.close()
  })
}

function criarBandejaServidor(): void {
  bandeja = new Tray(criarIconeServidor())
  bandeja.setToolTip('Servidor NossoSistema — Online')
  const menu = Menu.buildFromTemplate([
    { label: 'Servidor online', enabled: false },
    { type: 'separator' },
    { label: 'Abrir servidor', click: criarJanelaServidor },
    { label: 'Encerrar servidor', click: () => app.quit() }
  ])
  bandeja.setContextMenu(menu)
}

app.whenReady().then(async () => {
  registrarErroGlobal()
  if (process.argv.includes('--desinstalar')) {
    desinstalar()
    return
  }
  if (process.argv.includes('--servidor')) {
    // Modo servidor com bandeja: sobe a API e fica em segundo plano.
    // Fechar = menu da bandeja "Encerrar servidor".
    try {
      modoServidor = true
      registrarIpc()
      gravarLogServidor('registrarIpc ok')
      const ok = await iniciarServidorSeNecessario()
      if (!ok) {
        gravarLogServidor('servidor não subiu — saindo')
        app.exit(1)
        return
      }
      criarBandejaServidor()
      gravarLogServidor('bandeja criada')
      if (process.argv.includes('--abrir-painel')) {
        criarJanelaServidor()
        gravarLogServidor('painel aberto')
      }
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
      })
    } catch (e) {
      gravarLogServidor(`ERRO modo servidor: ${e instanceof Error ? e.message : String(e)}`)
    }
    return
  }
  if (process.env.TABACARIA_SERVIDOR) configurarServidor(process.env.TABACARIA_SERVIDOR)
  gravarLogServidor(`app iniciando (packaged=${app.isPackaged}, tipo=${tipoInstalacaoAtual()}, url=${getServidorUrl()})`)
  registrarIpc()
  gravarLogServidor('ipc ok')
  try {
    await verificarServidor()
    gravarLogServidor('servidor verificado — criando janela')
    createWindow()
    gravarLogServidor('janela criada')
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)
    console.error('[sistema] falha ao iniciar:', msg)
    gravarLogServidor(`ERRO ao iniciar: ${msg}`)
    dialog.showMessageBoxSync(mainWindow ?? undefined!, {
      type: 'error',
      title: `${PRODUTO} — erro ao iniciar`,
      message: `Falha ao iniciar o sistema:\n\n${msg}\n\nRegistro: %APPDATA%\\sistema-loja-tabacaria\\servidor-inicio.log`
    })
  }

  if (process.env.TABACARIA_TEST_UPDATE) {
    setTimeout(async () => {
      try {
        const v = await verificarAtualizacao()
        console.log('[teste:update] verificar=', JSON.stringify({ ativo: v.ativo, atual: v.atual, nova: v.nova, disponivel: v.disponivel }))
        if (!v.disponivel) {
          console.log('[teste:update] SEM NOVA VERSAO (esperado para electron em dev)')
          app.exit(0)
          return
        }
        const r = await instalarAtualizacao()
        console.log('[teste:update] instalar=', JSON.stringify(r))
        if (r.ok) {
          console.log('[teste:update] OK: baixou, validou e disparou instalador')
          app.exit(0)
        } else {
          console.log('[teste:update] FALHA:', r.erro)
          app.exit(1)
        }
      } catch (e) {
        console.error('[teste:update] ERRO:', e)
        app.exit(1)
      }
    }, 3000)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // No modo servidor (bandeja) fechar a janela mantém o servidor rodando.
  if (!modoServidor && process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  // O servidor roda em processo próprio (--servidor); no modo cliente ele
  // é encerrado separadamente pela bandeja.
})

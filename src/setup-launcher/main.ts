import { app, BrowserWindow, ipcMain } from 'electron'
import { join, basename, extname, relative, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  readdirSync,
  statSync
} from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { spawn, spawnSync, execSync } from 'node:child_process'
import { estaElevado, dirGravavel, relancarElevado } from './autoupdate-shared'

const PRODUTO = 'NossoSistema'
const APP_ID = 'br.com.lojatabacaria.sistema'
const APPDATA_DIR = 'sistema-loja-tabacaria'

function gravarLogServidor(msg: string): void {
  try {
    const logPath = join(pastaDadosApp(), 'servidor-inicio.log')
    const line = `${new Date().toISOString()} ${msg}\n`
    writeFileSync(logPath, line, { flag: 'a', encoding: 'utf8' })
  } catch { /* ignore */ }
}

async function rodarComCaptura(exe: string, args: string[], timeoutMs: number): Promise<{ code: number | null; sinal: string; erro?: string }> {
  return new Promise((resolve) => {
    const filho = spawn(exe, args, { windowsHide: true, stdio: 'ignore' })
    let resolvido = false
    const timer = setTimeout(() => {
      if (!resolvido) {
        resolvido = true
        try { filho.kill('SIGKILL') } catch { /* ignore */ }
        resolve({ code: null, sinal: 'timeout', erro: `timeout ${timeoutMs}ms` })
      }
    }, timeoutMs)
    filho.on('exit', (code) => {
      if (!resolvido) {
        resolvido = true
        clearTimeout(timer)
        resolve({ code: code ?? null, sinal: 'exit' })
      }
    })
    filho.on('error', (err) => {
      if (!resolvido) {
        resolvido = true
        clearTimeout(timer)
        resolve({ code: null, sinal: 'erro', erro: err.message })
      }
    })
  })
}

function dirPadrao(): string {
  if (process.env.SETUP_INSTALL_DIR) return process.env.SETUP_INSTALL_DIR
  // Empacotado: o launcher roda A PARTIR da pasta escolhida pelo usuário no
  // instalador (dirname de process.execPath). Nada de hardcoded — o sistema é
  // instalado onde o NSIS colocou o launcher (C:\NossoSistema ou outro).
  if (app.isPackaged) return dirname(process.execPath)
  return join(process.env.LOCALAPPDATA || join(process.env.USERPROFILE || '.', 'AppData', 'Local'), 'Programs', PRODUTO)
}

function pastaDadosApp(): string {
  if (process.env.SETUP_DADOS_DIR) return process.env.SETUP_DADOS_DIR
  return join(dirname(resolve(process.execPath)), APPDATA_DIR)
}

interface Instalacao {
  dir: string
  tipo: string
  versao: string
}

function lerInstalacao(dir: string): Instalacao | null {
  const cfg = join(dir, 'instalacao.json')
  if (!existsSync(cfg)) return null
  try {
    const j = JSON.parse(readFileSync(cfg, 'utf8')) as { tipo?: string; versao?: string }
    if (j.tipo !== 'servidor' && j.tipo !== 'cliente') return null
    return { dir, tipo: j.tipo, versao: j.versao || '' }
  } catch {
    return null
  }
}

function detectarInstalacao(): Instalacao | null {
  const dirs = [dirPadraoOuRegistro()]
  for (const d of dirs) {
    const i = lerInstalacao(d)
    if (i) return i
  }
  return null
}

function dirPadraoOuRegistro(): string {
  try {
    const out = execSync(
      `reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_ID}" /v InstallLocation`,
      { encoding: 'utf8', windowsHide: true }
    )
    const m = out.match(/InstallLocation\s+REG_SZ\s+(.+)/)
    if (m && m[1].trim()) return m[1].trim()
  } catch { /* sem registro */ }
  return dirPadrao()
}

function versaoEmbarcada(): string {
  return app.getVersion()
}

async function copiarArvore(
  origem: string,
  destino: string,
  onArquivo?: (n: number, total: number, atual: string) => void
): Promise<{ arquivos: number; bytes: number }> {
  const noAsarAntes = process.noAsar
  // Sem isso o patch de asar do Electron quebra cópia de arquivos nomeados
  // ".asar" (ex.: resources/app.asar) e do diretório app.asar.unpacked.
  process.noAsar = true
  try {
    const total = contarArquivos(origem)
    if (!existsSync(origem)) return { arquivos: 0, bytes: 0 }
    mkdirSync(destino, { recursive: true })
    let arquivos = 0
    let bytes = 0
    // Copia arquivo a arquivo (assíncrono) para o progresso chegar à janela.
    const pilha = [{ o: origem, d: destino }]
    while (pilha.length) {
      const { o, d } = pilha.pop() as { o: string; d: string }
      let entradas: import('node:fs').Dirent[]
      try {
        entradas = readdirSync(o, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entrada of entradas) {
        const po = join(o, entrada.name)
        const pd = join(d, entrada.name)
        try {
          if (entrada.isDirectory()) {
            mkdirSync(pd, { recursive: true })
            pilha.push({ o: po, d: pd })
          } else if (entrada.isFile()) {
            await copyFile(po, pd)
            arquivos++
            bytes += (statSync(pd)?.size ?? 0)
            if (onArquivo && arquivos % 25 === 0) onArquivo(arquivos, total, relative(origem, po))
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          console.error(`[setup] falha copiar: ${po} -> ${msg}`)
        }
      }
    }
    return { arquivos, bytes }
  } finally {
    process.noAsar = noAsarAntes
  }
}

function contarArquivos(dir: string): number {
  const noAsarAntes = process.noAsar
  process.noAsar = true
  try {
    if (!existsSync(dir)) return 0
    let n = 0
    const stack = [dir]
    while (stack.length) {
      const d = stack.pop() as string
      let entradas: string[]
      try {
        entradas = readdirSync(d)
      } catch {
        continue
      }
      for (const entrada of entradas) {
        const p = join(d, entrada)
        let st
        try {
          st = statSync(p)
        } catch {
          continue
        }
        if (st.isDirectory()) stack.push(p)
        else n++
      }
    }
    return n
  } finally {
    process.noAsar = noAsarAntes
  }
}

function caminhoEmbedded(): string {
  if (process.env.SETUP_EMBEDDED_DIR) return process.env.SETUP_EMBEDDED_DIR
  return join(process.resourcesPath, 'embedded')
}

function exeApp(dir: string): string | null {
  try {
    const nomesExe = readdirSync(dir).filter((f) => extname(f).toLowerCase() === '.exe')
    // Prefere o executável da APLICAÇÃO real. O launcher (NossoSistema.exe) e
    // o uninstaller (Uninstall *.exe) NUNCA são o alvo — só o app do sistema.
    const app = nomesExe.find(
      (f) =>
        f.toLowerCase() !== 'nosso sistema.exe' &&
        f.toLowerCase() !== 'nos-sistema.exe' &&
        !/^uninstall/i.test(f) &&
        f.toLowerCase() !== basename(process.execPath).toLowerCase()
    )
    if (app) return join(dir, app)
    for (const f of nomesExe) {
      if (f.toLowerCase() !== basename(process.execPath).toLowerCase() && !/^uninstall/i.test(f)) {
        return join(dir, f)
      }
    }
  } catch { /* ignore */ }
  return null
}

function criarAtalho(nome: string, alvo: string, pastaLnk: string, icone?: string, argumentos?: string): void {
  try {
    mkdirSync(pastaLnk, { recursive: true })
    const vbs = join(app.getPath('temp'), `criar-atalho-${Date.now()}.vbs`)
    const linhas = [
      `Set ws = CreateObject("WScript.Shell")`,
      `Set s = ws.CreateShortcut("${join(pastaLnk, nome + '.lnk')}")`,
      `s.TargetPath = "${alvo}"`,
      `s.WorkingDirectory = "${join(alvo, '..')}"`,
      argumentos ? `s.Arguments = "${argumentos}"` : '',
      icone && existsSync(icone) ? `s.IconLocation = "${icone},0"` : '',
      `s.Save()`
    ].filter(Boolean)
    writeFileSync(vbs, linhas.join('\r\n'), 'utf8')
    execSync(`cscript.exe //nologo "${vbs}"`, { windowsHide: true })
  } catch { /* ignore */ }
}

// Remove atalhos técnicos antigos que o próprio sistema criou em versões
// anteriores (Iniciar/Parar Servidor, Servidor separado). Mantém apenas os
// dois oficiais: "NossoSistema" e "NossoSistema Servidor".
function limparAtalhosAntigos(): void {
  const desktop = join(process.env.USERPROFILE || '.', 'Desktop')
  const menu = join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', PRODUTO)
  const antigos = [
    'Servidor.lnk',
    'Iniciar Servidor.lnk',
    'Parar Servidor.lnk',
    'Sistema Loja Tabacaria.lnk',
    'NossoSistema Setup.lnk',
    'NossoSistema-Servidor.lnk'
  ]
  for (const nome of antigos) {
    for (const pasta of [desktop, menu]) {
      try {
        const p = join(pasta, nome)
        if (existsSync(p)) rmSync(p, { force: true })
      } catch { /* ignore */ }
    }
  }
  // Arquivos auxiliares antigos que não devem existir como "aplicativos"
  try {
    const ps1 = join(dirPadrao(), 'parar-servidor.ps1')
    if (existsSync(ps1)) rmSync(ps1, { force: true })
  } catch { /* ignore */ }
}

// Cria SOMENTE os dois atalhos oficiais:
//   - "NossoSistema" → abre o sistema/PDV (sem flag)
//   - "NossoSistema Servidor" → abre o painel do servidor (--servidor --abrir-painel)
function criarAtalhos(dir: string, exe: string): void {
  limparAtalhosAntigos()
  const desktop = join(process.env.USERPROFILE || '.', 'Desktop')
  const menu = join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', PRODUTO)
  const iconeSistema = join(dir, 'resources', 'sistema.ico')
  const iconeServidor = join(dir, 'resources', 'servidor.ico')
  // NossoSistema (PDV) — sem argumentos; ícone do sistema se disponível, senão o exe.
  criarAtalho(PRODUTO, exe, desktop, existsSync(iconeSistema) ? iconeSistema : exe)
  criarAtalho(PRODUTO, exe, menu, existsSync(iconeSistema) ? iconeSistema : exe)
  // NossoSistema Servidor — painel do servidor (abre a interface, não só bandeja)
  const args = '--servidor --abrir-painel'
  criarAtalho(`${PRODUTO} Servidor`, exe, desktop, existsSync(iconeServidor) ? iconeServidor : exe, args)
  criarAtalho(`${PRODUTO} Servidor`, exe, menu, existsSync(iconeServidor) ? iconeServidor : exe, args)
}

function registrarServidor(dir: string): void {
  const exe = exeApp(dir)
  if (!exe) return
  // Migração: remove autostart antigo via .vbs (versões anteriores)
  try {
    const vbsAntigo = join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', `${PRODUTO}-servidor.vbs`)
    if (existsSync(vbsAntigo)) rmSync(vbsAntigo, { force: true })
  } catch { /* ignore */ }
  const chaveRun = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run`
  try {
    execSync(`reg add "${chaveRun}" /v "${PRODUTO} Servidor" /d "\\"${exe}\\" --servidor" /f`, { windowsHide: true })
  } catch { /* ignore */ }
  try {
    execSync(
      `netsh advfirewall firewall add rule name="${PRODUTO} Servidor" dir=in action=allow program="${exe}" enable=yes`,
      { windowsHide: true }
    )
  } catch { /* sem admin: firewall não configurado */ }
}

function gravarRegistro(dir: string, tipo: string): void {
  try {
    const chave = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_ID}`
    const display = tipo === 'servidor' ? `${PRODUTO} (Servidor + Sistema)` : `${PRODUTO} (Somente Sistema)`
    const exe = exeApp(dir)
    execSync(`reg add "${chave}" /v DisplayName /d "${display}" /f`, { windowsHide: true })
    execSync(`reg add "${chave}" /v DisplayVersion /d "${versaoEmbarcada()}" /f`, { windowsHide: true })
    execSync(`reg add "${chave}" /v InstallLocation /d "${dir}" /f`, { windowsHide: true })
    execSync(`reg add "${chave}" /v Publisher /d "${PRODUTO}" /f`, { windowsHide: true })
    // Desinstalação real: Windows executa o app com --desinstalar
    if (exe) {
      execSync(`reg add "${chave}" /v UninstallString /d "\\"${exe}\\" --desinstalar" /f`, { windowsHide: true })
      execSync(`reg add "${chave}" /v DisplayIcon /d "${exe}" /f`, { windowsHide: true })
      execSync(`reg add "${chave}" /v NoModify /d 1 /t REG_DWORD /f`, { windowsHide: true })
      execSync(`reg add "${chave}" /v NoRepair /d 1 /t REG_DWORD /f`, { windowsHide: true })
    }
  } catch { /* ignore */ }
}

function gravarConfigServidor(): void {
  try {
    mkdirSync(pastaDadosApp(), { recursive: true })
    writeFileSync(join(pastaDadosApp(), 'servidor.url'), '', 'utf8')
  } catch { /* ignore */ }
}

function removerServidorAutostart(): void {
  const chaveRun = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run`
  try {
    execSync(`reg delete "${chaveRun}" /v "${PRODUTO} Servidor" /f`, { windowsHide: true })
  } catch { /* ignore */ }
  try {
    execSync(`netsh advfirewall firewall delete rule name="${PRODUTO} Servidor"`, { windowsHide: true })
  } catch { /* ignore */ }
}

// Concede permissão de escrita SOMENTE ao usuário atual na pasta de instalação.
// Necessário para o autoupdate substituir arquivos sem elevação (o autoupdate
// roda como usuário comum). NÃO concede ao grupo "Users" inteiro — apenas ao
// usuário que instalou, preservando a segurança dos demais usuários do sistema.
function concederAclUsuarioAtual(dir: string): void {
  try {
    const user = process.env.USERNAME || ''
    if (!user) return
    // (OI)(CI)M = herança de objetos e contêineres + Modify. Aplica em diretórios
    // e subpastas, mas SOMENTE para o usuário logado que está instalando.
    execSync(`icacls "${dir}" /grant "${user}:(OI)(CI)M" /T /Q`, { windowsHide: true })
  } catch { /* sem permissão para icacls — autoupdate pode exigir elevação */ }
}

async function instalar(args: { tipo: string }): Promise<{ ok: boolean; erro?: string; dir?: string; exe?: string }> {
  const dir = dirPadrao()
  const emb = caminhoEmbedded()
  const appSrc = join(emb, 'app')
  if (!existsSync(appSrc)) {
    return { ok: false, erro: 'Componentes do sistema não encontrados no instalador.' }
  }

  // Se a pasta de instalação escolhida (ex.: C:\NossoSistema criada por admin)
  // não for gravável pelo processo atual, relança o launcher ELEVADO (UAC) para
  // conseguir copiar os arquivos e conceder a ACL ao usuário. Sem isso a cópia
  // falharia com EPERM em pastas protegidas.
  if (!estaElevado() && !dirGravavel(dir) && process.env.SETUP_ELEVATED !== '1') {
    gravarLogServidor(`[setup] pasta não gravável (${dir}) — relançando elevado`)
    const code = relancarElevado({ SETUP_INSTALL_DIR: dir, SETUP_TIPO: args.tipo })
    if (code === null) {
      // Usuário cancelou o UAC ou não conseguiu lançar elevado.
      return { ok: false, erro: 'Permissão necessária para instalar nesta pasta. Tente novamente e confirme a elevação.' }
    }
    // O processo elevado concluiu a instalação. Sai do launcher original sem
    // relançar o app novamente (o processo elevado já o fez).
    app.exit(code === 0 ? 0 : 1)
    return { ok: false, erro: 'Relançado com elevação' }
  }

  try {
    gravarLogServidor(`[setup] aguardando app fechar: ${dir}`)
    await esperarAppFechado(dir)
    gravarLogServidor('[setup] app fechado, copiando arquivos')
    await copiarArvore(appSrc, dir, (n, total, atual) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) win.webContents.send('setup:progresso', { etapa: 'aplicativo', arquivos: n, total, atual })
    })
    gravarLogServidor('[setup] cópia concluída, copiando autoupdate')
    const autoupdateSrc = join(process.resourcesPath, 'autoupdate')
    if (existsSync(autoupdateSrc)) {
      await copiarArvore(autoupdateSrc, join(dir, 'autoupdate'))
      gravarLogServidor(`[setup] autoupdate copiado para ${join(dir, 'autoupdate')}`)
    } else {
      gravarLogServidor('[setup] autoupdate não encontrado no instalador (instalação sem autoupdate)')
    }
    gravarLogServidor('[setup] cópia concluída, concedendo ACL ao usuário atual')
    concederAclUsuarioAtual(dir)
    gravarLogServidor('[setup] cópia concluída, gravando instalacao.json')
    if (args.tipo === 'servidor') {
      registrarServidor(dir)
      gravarConfigServidor()
    } else {
      removerServidorAutostart()
    }
    writeFileSync(
      join(dir, 'instalacao.json'),
      JSON.stringify({ tipo: args.tipo, versao: versaoEmbarcada(), instalado_em: new Date().toISOString() }, null, 2),
      'utf8'
    )
    gravarLogServidor('[setup] instalacao.json gravado')
    gravarRegistro(dir, args.tipo)
    const exe = exeApp(dir)
    if (exe) {
      criarAtalhos(dir, exe)
    }
    gravarLogServidor('[setup] instalação OK')
    return { ok: true, dir, exe: exe || undefined }
  } catch (e) {
    const err = e as Error
    gravarLogServidor(`[setup] ERRO instalação: ${err.message}\n${err.stack}`)
    console.error('[setup] erro instalação:', err.message, '\n', err.stack)
    return { ok: false, erro: err.message }
  }
}

async function desinstalar(dir: string): Promise<{ ok: boolean; erro?: string }> {
  const noAsarAntes = process.noAsar
  process.noAsar = true
  try {
    await esperarAppFechado(dir)
    removerServidorAutostart()
    limparAtalhosAntigos()
    const menu = join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', PRODUTO)
    if (existsSync(menu)) rmSync(menu, { recursive: true, force: true })
    const desktop = join(process.env.USERPROFILE || '.', 'Desktop')
    for (const nome of [`${PRODUTO}.lnk`, `${PRODUTO} Servidor.lnk`, 'Servidor.lnk', 'Iniciar Servidor.lnk', 'Parar Servidor.lnk', 'Sistema Loja Tabacaria.lnk']) {
      const p = join(desktop, nome)
      if (existsSync(p)) rmSync(p, { force: true })
    }
    execSync(`reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_ID}" /f`, { windowsHide: true })
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    return { ok: true }
  } catch (e) {
    const err = e as Error
    console.error('[setup] erro desinstalação:', err.message, '\n', err.stack)
    return { ok: false, erro: err.message }
  } finally {
    process.noAsar = noAsarAntes
  }
}

function matarAppInstalado(dir: string): void {
  try {
    const exe = exeApp(dir)
    if (!exe) return
    // Mata SOMENTE processos cujo executável está DENTRO desta pasta de
    // instalação — nunca outras cópias (ex.: servidor em produção na mesma
    // máquina ou instalação de teste). taskkill /IM por nome derrubaria tudo.
    const alvo = exe.replace(/'/g, "''")
    const ps = `Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${alvo}' } | Stop-Process -Force`
    spawn('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'ignore', windowsHide: true })
  } catch { /* ignore */ }
}

// Derruba o app da instalação e AGUARDA o término REAL em loop (poll por
// caminho completo do executável, nunca por nome). Timeout ~10s: se o
// processo não sair, LANÇA erro — a atualização aborta sem copiar nada,
// evitando instalação parcial com exe antigo + asar novo.
async function esperarAppFechado(dir: string): Promise<void> {
  const exe = exeApp(dir)
  if (!exe) return
  const alvo = exe.replace(/'/g, "''")
  const matar = (): void => {
    try {
      const ps = `Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${alvo}' } | Stop-Process -Force`
      spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
    } catch { /* ignore */ }
  }
  const rodando = (): boolean => {
    try {
      const ps = `@((Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${alvo}' })).Count`
      const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
      return parseInt(((r.stdout as string) || '0').trim(), 10) > 0
    } catch {
      return true // consulta falhou ⇒ trata como ainda rodando até o timeout decidir
    }
  }
  matar()
  const fim = Date.now() + 10000
  let reforco = 0
  while (Date.now() < fim) {
    if (!rodando()) return
    reforco++
    if (reforco % 2 === 0) matar() // reforça o kill durante a espera
    await new Promise((r) => setTimeout(r, 400))
  }
  if (rodando()) {
    throw new Error(`Aplicativo não encerrou em 10s (${exe}) — atualização abortada sem copiar arquivos`)
  }
}

function relançarApp(exe: string): void {
  try {
    const filho = spawn(exe, [], {
      cwd: dirname(exe),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, SETUP_DADOS_DIR: pastaDadosApp() }
    })
    filho.on('error', (e) => console.error('[setup] falha ao abrir sistema:', e.message))
    filho.unref()
  } catch (e) {
    console.error('[setup] falha ao abrir sistema:', e instanceof Error ? e.message : String(e))
  }
}

function finalizarSilencioso(resultado: { ok: boolean; exe?: string }): void {
  if (resultado.ok && resultado.exe) {
    relançarApp(resultado.exe)
    // Give the child process time to start and acquire its own single-instance
    // lock before the launcher exits and releases its resources.
    setTimeout(() => app.exit(0), 3000)
  } else {
    app.exit(resultado.ok ? 0 : 1)
  }
}

function iniciarFluxoSilencioso(): void {
  const argv = process.argv.join(' ')
  const tipo = argv.match(/\/TIPO=(\w+)/)?.[1]
  const autoupdate = /\/AUTOUPDATE=1/.test(argv)
  const url = argv.match(/\/UPDATE_URL=([^\s]+)/)?.[1]
  if (url) {
    try {
      mkdirSync(pastaDadosApp(), { recursive: true })
      writeFileSync(join(pastaDadosApp(), 'update.url'), url.replace(/\/$/, ''), 'utf8')
    } catch { /* ignore */ }
  }
  const tipoFinal = tipo === 'cliente' || tipo === 'servidor' ? tipo : detectarInstalacao()?.tipo || 'servidor'
  instalar({ tipo: tipoFinal })
    .then((resultado) => {
      if (autoupdate) {
        finalizarSilencioso(resultado)
      } else {
        app.exit(resultado.ok ? 0 : 1)
      }
    })
    .catch(() => app.exit(1))
}

function criarJanela(): void {
  const win = new BrowserWindow({
    width: 640,
    height: 720,
    resizable: false,
    autoHideMenuBar: true,
    title: `Instalar ${PRODUTO}`,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.loadFile(join(__dirname, 'index.html'))
}

function registrarIpc(): void {
  ipcMain.handle('setup:estado', () => {
    const instalacao = detectarInstalacao()
    return {
      existe: !!instalacao,
      dir: instalacao?.dir || null,
      tipoAtual: instalacao?.tipo || null,
      versaoAtual: instalacao?.versao || null,
      versaoNova: versaoEmbarcada()
    }
  })

  ipcMain.handle('setup:instalar', (_e, tipo: string) => {
    return instalar({ tipo: tipo === 'cliente' ? 'cliente' : 'servidor' })
  })

  ipcMain.handle('setup:atualizar', () => {
    const existente = detectarInstalacao()
    return instalar({ tipo: existente?.tipo || 'servidor' })
  })

  ipcMain.handle('setup:reinstalar', () => {
    const existente = detectarInstalacao()
    return instalar({ tipo: existente?.tipo || 'servidor' })
  })

  ipcMain.handle('setup:desinstalar', () => {
    const existente = detectarInstalacao()
    if (!existente) return { ok: false, erro: 'Nenhuma instalação encontrada.' }
    return desinstalar(existente.dir)
  })

  ipcMain.handle('setup:relancar', (_e, exe: string) => {
    if (exe) relançarApp(exe)
    return { ok: true }
  })

  ipcMain.handle('setup:sair', () => {
    app.quit()
  })

  ipcMain.handle('setup:servidorRodando', async () => {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 2500)
      const res = await fetch('http://localhost:3210/api/servidor/status', { signal: ctrl.signal })
      clearTimeout(timer)
      return res.ok
    } catch {
      return false
    }
  })
}

// The setup launcher is a one-shot installer/updater. It does NOT need a
// single-instance lock — in fact, holding one causes a race condition when
// relançarApp() spawns the main app (which also requests the lock). Since
// the launcher exits right after spawning, we simply omit the lock.
app.whenReady().then(() => {
  registrarIpc()
  if (process.env.SETUP_TEST_INSTALL) {
    const args = { tipo: process.env.SETUP_TEST_TIPO || 'servidor', enderecoServidor: process.env.SETUP_TEST_ENDERECO }
    instalar(args)
      .then((r) => {
        console.log('[setup:teste]', JSON.stringify(r))
        app.exit(r.ok ? 0 : 1)
      })
      .catch(() => app.exit(1))
    return
  }
  if (/\/S\b/.test(process.argv.join(' ')) || /--silent/.test(process.argv.join(' '))) {
    iniciarFluxoSilencioso()
  } else {
    criarJanela()
  }
})
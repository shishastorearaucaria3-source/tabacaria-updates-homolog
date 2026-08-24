import { join, basename, extname, dirname, resolve } from 'node:path';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  readdirSync,
  statSync,
  copyFileSync,
  renameSync,
} from 'node:fs';
import { spawn, spawnSync, execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const PRODUTO = 'NossoSistema';
const APP_ID = 'br.com.lojatabacaria.sistema';
const APPDATA_DIR = 'sistema-loja-tabacaria';

export function dirPadrao(): string {
  if (process.env.SETUP_INSTALL_DIR) return process.env.SETUP_INSTALL_DIR;
  return join(process.env.LOCALAPPDATA || join(process.env.USERPROFILE || '.', 'AppData', 'Local'), 'Programs', PRODUTO);
}

export function pastaDadosApp(): string {
  if (process.env.SETUP_DADOS_DIR) return process.env.SETUP_DADOS_DIR;
  return join(process.env.APPDATA || join(process.env.USERPROFILE || '.', 'AppData', 'Roaming'), APPDATA_DIR);
}

export function exeApp(dir: string): string | null {
  try {
    for (const f of readdirSync(dir)) {
      if (extname(f).toLowerCase() === '.exe' && f.toLowerCase() !== basename(process.execPath).toLowerCase()) {
        return join(dir, f);
      }
    }
  } catch { /* ignore */ }
  return null;
}

export function gravarLogServidor(msg: string): void {
  try {
    const logPath = join(pastaDadosApp(), 'servidor-inicio.log');
    const line = `${new Date().toISOString()} ${msg}\n`;
    writeFileSync(logPath, line, { flag: 'a', encoding: 'utf8' });
  } catch { /* ignore */ }
}

export async function rodarComCaptura(exe: string, args: string[], timeoutMs: number): Promise<{ code: number | null; sinal: string; erro?: string }> {
  return new Promise((resolve) => {
    const filho = spawn(exe, args, { windowsHide: true, stdio: 'ignore' });
    let resolvido = false;
    const timer = setTimeout(() => {
      if (!resolvido) {
        resolvido = true;
        try { filho.kill('SIGKILL') } catch { /* ignore */ }
        resolve({ code: null, sinal: 'timeout', erro: `timeout ${timeoutMs}ms` });
      }
    }, timeoutMs);
    filho.on('exit', (code) => {
      if (!resolvido) {
        resolvido = true;
        clearTimeout(timer);
        resolve({ code: code ?? null, sinal: 'exit' });
      }
    });
    filho.on('error', (err) => {
      if (!resolvido) {
        resolvido = true;
        clearTimeout(timer);
        resolve({ code: null, sinal: 'erro', erro: err.message });
      }
    });
  });
}

function matarAppInstalado(dir: string): void {
  try {
    const exe = exeApp(dir);
    if (!exe) return;
    const alvo = exe.replace(/'/g, "''");
    const ps = `Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${alvo}' } | Stop-Process -Force`;
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  } catch { /* ignore */ }
}

function appRodando(exe: string): boolean {
  try {
    const alvo = exe.replace(/'/g, "''");
    const ps = `@((Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${alvo}' })).Count`;
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    return parseInt(((r.stdout as string) || '0').trim(), 10) > 0;
  } catch {
    return true;
  }
}

export async function esperarAppFechado(dir: string): Promise<void> {
  const exe = exeApp(dir);
  if (!exe) return;
  const alvo = exe.replace(/'/g, "''");
  const matar = (): void => {
    try {
      const ps = `Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${alvo}' } | Stop-Process -Force`;
      spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    } catch { /* ignore */ }
  };
  const rodando = (): boolean => {
    try {
      const ps = `@((Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${alvo}' })).Count`;
      const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
      return parseInt(((r.stdout as string) || '0').trim(), 10) > 0;
    } catch {
      return true;
    }
  };
  matar();
  const fim = Date.now() + 10000;
  let reforco = 0;
  while (Date.now() < fim) {
    if (!rodando()) return;
    reforco++;
    if (reforco % 2 === 0) matar();
    await new Promise((r) => setTimeout(r, 400));
  }
  if (rodando()) {
    throw new Error(`Aplicativo não encerrou em 10s (${exe}) — atualização abortada sem copiar arquivos`);
  }
}

export async function copiarArvore(
  origem: string,
  destino: string,
  onArquivo?: (n: number, total: number, atual: string) => void
): Promise<{ arquivos: number; bytes: number }> {
  if (!existsSync(origem)) return { arquivos: 0, bytes: 0 };
  mkdirSync(destino, { recursive: true });
  let arquivos = 0;
  let bytes = 0;
  const pilha = [{ o: origem, d: destino }];
  while (pilha.length) {
    const { o, d } = pilha.pop() as { o: string; d: string };
    let entradas;
    try {
      entradas = readdirSync(o, { withFileTypes: true });
    } catch { continue; }
    for (const entrada of entradas) {
      const po = join(o, entrada.name);
      const pd = join(d, entrada.name);
      try {
        if (entrada.isDirectory()) {
          mkdirSync(pd, { recursive: true });
          pilha.push({ o: po, d: pd });
        } else if (entrada.isFile()) {
          copyFileSync(po, pd);
          const st = statSync(po);
          arquivos++;
          bytes += st.size;
          if (onArquivo) onArquivo(arquivos, 0, entrada.name);
        }
      } catch { /* ignore */ }
    }
  }
  return { arquivos, bytes };
}

export function gravarRegistro(dir: string, tipo: string, versao?: string): void {
  try {
    const chave = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_ID}`;
    const display = tipo === 'servidor' ? `${PRODUTO} (Servidor + Sistema)` : `${PRODUTO} (Somente Sistema)`;
    const exe = exeApp(dir);
    // A versão deve ser passada explicitamente (ex.: versaoEsperada no fluxo
    // autoupdate). O fallback versaoEmbarcada() só vale em contexto Electron
    // (launcher), onde package.json existe ao lado do executável.
    const versaoFinal = versao || versaoEmbarcada();
    execSync(`reg add "${chave}" /v DisplayName /d "${display}" /f`, { windowsHide: true });
    execSync(`reg add "${chave}" /v DisplayVersion /d "${versaoFinal}" /f`, { windowsHide: true });
    execSync(`reg add "${chave}" /v InstallLocation /d "${dir}" /f`, { windowsHide: true });
    execSync(`reg add "${chave}" /v Publisher /d "${PRODUTO}" /f`, { windowsHide: true });
    if (exe) {
      execSync(`reg add "${chave}" /v UninstallString /d "\\"${exe}\\" --desinstalar" /f`, { windowsHide: true });
      execSync(`reg add "${chave}" /v DisplayIcon /d "${exe}" /f`, { windowsHide: true });
      execSync(`reg add "${chave}" /v NoModify /d 1 /t REG_DWORD /f`, { windowsHide: true });
      execSync(`reg add "${chave}" /v NoRepair /d 1 /t REG_DWORD /f`, { windowsHide: true });
    }
  } catch { /* ignore */ }
}

export function gravarConfigServidor(): void {
  try {
    mkdirSync(pastaDadosApp(), { recursive: true });
    writeFileSync(join(pastaDadosApp(), 'servidor.url'), '', 'utf8');
  } catch { /* ignore */ }
}

export function removerServidorAutostart(): void {
  const chaveRun = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run`;
  try {
    execSync(`reg delete "${chaveRun}" /v "${PRODUTO} Servidor" /f`, { windowsHide: true });
  } catch { /* ignore */ }
  try {
    execSync(`netsh advfirewall firewall delete rule name="${PRODUTO} Servidor"`, { windowsHide: true });
  } catch { /* ignore */ }
}

export function criarAtalho(nome: string, alvo: string, pastaLnk: string, icone?: string, argumentos?: string): void {
  try {
    mkdirSync(pastaLnk, { recursive: true });
    const ps = `
      $WshShell = New-Object -ComObject WScript.Shell
      $Shortcut = $WshShell.CreateShortcut('${join(pastaLnk, nome).replace(/'/g, "''")}.lnk')
      $Shortcut.TargetPath = '${alvo.replace(/'/g, "''")}'
      ${argumentos ? `$Shortcut.Arguments = '${argumentos.replace(/'/g, "''")}'` : ''}
      ${icone ? `$Shortcut.IconLocation = '${icone.replace(/'/g, "''")}'` : ''}
      $Shortcut.Save()
    `;
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  } catch { /* ignore */ }
}

export function criarAtalhos(dir: string, exe: string): void {
  const desktop = join(process.env.USERPROFILE || '.', 'Desktop');
  const menu = join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', PRODUTO);
  criarAtalho(PRODUTO, exe, desktop, exe);
  criarAtalho(PRODUTO, exe, menu, exe);
}

export function criarAtalhoServidor(dir: string, exe: string): void {
  const desktop = join(process.env.USERPROFILE || '.', 'Desktop');
  const menu = join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', PRODUTO);
  criarAtalho('Servidor', exe, desktop, exe, '--servidor');
  criarAtalho('Iniciar Servidor', exe, menu, exe, '--servidor');
  criarAtalho('Parar Servidor', exe, menu, exe, '--parar-servidor');
}

export function relançarApp(exe: string): void {
  try {
    const filho = spawn(exe, [], {
      cwd: dirname(exe),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    filho.on('error', (e) => console.error('[autoupdate] falha ao abrir sistema:', e.message));
    filho.unref();
  } catch (e) {
    console.error('[autoupdate] falha ao abrir sistema:', e instanceof Error ? e.message : String(e));
  }
}

export function versaoEmbarcada(): string {
  try {
    const pkgPath = join(dirname(resolve(process.execPath)), 'package.json');
    if (existsSync(pkgPath)) {
      return JSON.parse(readFileSync(pkgPath, 'utf8')).version || '0.0.0';
    }
  } catch { /* ignore */ }
  return '0.0.0';
}

export function lerVersaoInstalada(dir: string): string | null {
  try {
    const cfg = join(dir, 'instalacao.json');
    if (!existsSync(cfg)) return null;
    return JSON.parse(readFileSync(cfg, 'utf8')).versao || null;
  } catch { return null; }
}

export function lerTipoInstalado(dir: string): string | null {
  try {
    const cfg = join(dir, 'instalacao.json');
    if (!existsSync(cfg)) return null;
    return JSON.parse(readFileSync(cfg, 'utf8')).tipo || null;
  } catch { return null; }
}

export interface AutoupdateResultado {
  ok: boolean;
  versao: string;
  timestamp: string;
  estagio: string;
  erro?: string;
}

export function escreverMarkerAtomico(markerPath: string, resultado: AutoupdateResultado): void {
  const tmp = markerPath + '.tmp';
  writeFileSync(tmp, JSON.stringify(resultado, null, 2), 'utf8');
  renameSync(tmp, markerPath);
}

export function obterMarkerPath(): string {
  return join(tmpdir(), `nos-autoupdate-resultado-${process.pid}-${Date.now()}.json`);
}

export function adquirirLock(dir: string): { ok: boolean; lockPath: string; cleanup: () => void } {
  const lockPath = join(dir, '.autoupdate.lock');
  try {
    writeFileSync(lockPath, `${process.pid}\n${Date.now()}\n`, { flag: 'wx', encoding: 'utf8' });
    return {
      ok: true,
      lockPath,
      cleanup: () => { try { rmSync(lockPath, { force: true }) } catch { /* ignore */ } },
    };
  } catch {
    return { ok: false, lockPath, cleanup: () => {} };
  }
}

export function validarEstruturaPayload(extraidoDir: string): { ok: boolean; erro?: string; versao?: string; exePath?: string } {
  const appDir = join(extraidoDir, 'resources', 'embedded', 'app');
  if (!existsSync(appDir)) return { ok: false, erro: 'Pasta app não encontrada no payload extraído' };
  const asarPath = join(appDir, 'resources', 'app.asar');
  if (!existsSync(asarPath)) return { ok: false, erro: 'app.asar não encontrado' };
  const exePath = exeApp(appDir);
  if (!exePath) return { ok: false, erro: 'Executável principal não encontrado no payload' };
  // O package.json fica DENTRO do app.asar (formato do Electron), não como arquivo
  // solto. Para obter a versão de forma confiável sem depender do @electron/asar
  // (o autoupdate roda com node.exe standalone), usamos o FileVersion do EXE.
  try {
    const alvo = exePath.replace(/'/g, "''")
    const ps = `(Get-Item -LiteralPath '${alvo}').VersionInfo.FileVersion`
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
    const versao = ((r.stdout as string) || '').trim() || 'desconhecida'
    return { ok: true, versao, exePath };
  } catch {
    return { ok: false, erro: 'Falha ao ler versão do payload' };
  }
}
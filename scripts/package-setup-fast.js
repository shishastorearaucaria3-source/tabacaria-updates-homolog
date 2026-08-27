// package-setup-fast.js
//
// Build RÁPIDO do instalador para desenvolvimento/validação do NSIS.
//
// O instalador empacota DIRETAMENTE o aplicativo real (out/**/*) como o app
// principal — NÃO há setup-launcher, NÃO há payload embedded/app, NÃO há
// autoupdate nem node.exe. O NossoSistema-Servidor.exe é gerado em tempo de
// instalação a partir do próprio NossoSistema.exe (mesmo binário, modo servidor
// detectado pelo nome).
//
// Quando você altera APENAS build/installer.nsh ou electron-builder.setup.yml,
// este script vai direto ao electron-builder + makensis, sem rodar:
//   build:app, build:servidor, electron-builder.portable, copiar-servidor-dist
const { spawnSync } = require('node:child_process')
const { existsSync, statSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = process.cwd()

function ok(msg) { console.log(`[fast] ✓ ${msg}`) }
function info(msg) { console.log(`[fast] · ${msg}`) }
function fail(msg) { console.error(`[fast] ✗ ${msg}`) }

// ---------------------------------------------------------------------------
// Pré-requisitos essenciais (não podem ser gerados pelo fluxo rápido; se
// faltarem, rode `npm run build:app` antes).
// ---------------------------------------------------------------------------
const REQUERIDOS = [
  { path: join('out', 'main', 'index.js'), rotulo: 'app real (out/main/index.js)' },
  { path: join('src', 'panel-servidor'), rotulo: 'painel do servidor (src/panel-servidor)' },
]

let faltando = []
for (const r of REQUERIDOS) {
  if (!existsSync(join(ROOT, r.path))) faltando.push(r.rotulo)
}
if (faltando.length) {
  console.error('[fast] Artefatos obrigatórios ausentes:')
  for (const f of faltando) console.error('        - ' + f)
  console.error('[fast] Rode "npm run build:app" uma vez para gerá-los, depois use "npm run package:setup:fast".')
  process.exit(1)
}
ok('App real e recursos do instalador presentes')

// ---------------------------------------------------------------------------
// electron-builder setup -> NSIS -> NossoSistema-Setup.exe
// NÃO há override de main: o app instalado é o sistema real
// (package.json main = out/main/index.js), nunca o setup-launcher.
// ---------------------------------------------------------------------------
info('Rodando electron-builder (setup) + makensis...')
const args = [
  '--config', 'electron-builder.setup.yml',
  '--publish', 'never',
]
const t0 = Date.now()
const eb = spawnSync('npx.cmd', ['electron-builder', ...args], { cwd: ROOT, stdio: 'inherit', shell: true })
if (eb.status !== 0) {
  fail('electron-builder falhou (consulte a saída acima)')
  process.exit(eb.status || 1)
}

// ---------------------------------------------------------------------------
// Confirma o instalador gerado
// ---------------------------------------------------------------------------
const setupExe = join(ROOT, 'dist-setup', 'NossoSistema-Setup.exe')
if (!existsSync(setupExe)) {
  fail('Instalador não encontrado: dist-setup/NossoSistema-Setup.exe')
  process.exit(1)
}
const mb = (statSync(setupExe).size / 1024 / 1024).toFixed(1)
const seg = ((Date.now() - t0) / 1000).toFixed(0)
console.log('')
console.log('┌──────────────────────────────────────────────────────────┐')
console.log('│  PRONTO — instalador gerado                              │')
console.log('│                                                          │')
console.log('│  dist-setup/NossoSistema-Setup.exe                       │')
console.log(`│  Tamanho: ${mb} MB                                     │`)
console.log(`│  Tempo do electron-builder+makensis: ${seg}s            │`)
console.log('└──────────────────────────────────────────────────────────┘')
ok(`Pronto: dist-setup/NossoSistema-Setup.exe (${mb} MB)`)

// Registra o servidor para iniciar junto com o Windows (oculto, sem janela).
// Uso: node scripts/instalar-servidor.js
// O servidor continua acessível pela rede: http://<ip>:<porta> (porta gravada em servidor.porta)
const { execSync } = require('node:child_process')
const { existsSync, writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')
const os = require('node:os')

function caminhoServidor() {
  const candidatos = [
    join(process.cwd(), 'out', 'server', 'server', 'index.js'),
    join(process.resourcesPath || '', 'app.asar.unpacked', 'server', 'server', 'index.js'),
    join(process.resourcesPath || '', 'server', 'server', 'index.js')
  ]
  for (const c of candidatos) {
    if (existsSync(c)) return c
  }
  return null
}

function caminhoNode() {
  try {
    return execSync('where node', { encoding: 'utf8' }).trim().split(/\r?\n/)[0]
  } catch {
    return process.execPath
  }
}

function pastaInicializar() {
  return join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
}

const servidor = caminhoServidor()
if (!servidor) {
  console.error('[instalar] Servidor não compilado. Rode: npm run build:servidor')
  process.exit(1)
}

const nodeBin = caminhoNode()
const destino = join(pastaInicializar(), 'sistema-loja-tabacaria-servidor.vbs')

// VBS roda o node com o servidor sem abrir janela (window style 0 = hidden).
const vbs = `Set sh = CreateObject("WScript.Shell")
sh.Run "\""${nodeBin}"\"" "\""${servidor}"\"", 0, False
`

mkdirSync(pastaInicializar(), { recursive: true })
writeFileSync(destino, vbs, 'utf8')

console.log(`[instalar] Servidor registrado para iniciar com o Windows.`)
console.log(`[instalar] Arquivo: ${destino}`)
console.log(`[instalar] Servidor: ${servidor}`)
console.log(`[instalar] Node: ${nodeBin}`)
console.log(`[instalar] O servidor sobe sozinho ao ligar o PC e fica acessível na rede local.`)
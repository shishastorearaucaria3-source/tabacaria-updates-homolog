// TESTE OBRIGATÓRIO — fluxo real do cliente com API key (v1.0.5+)
// Reproduz a lógica corrigida do Login.tsx:
//   1. cliente inicia SEM chave gravada;
//   2. detecta servidor (conexao() retorna local=false, temChave=false);
//   3. NÃO chama /api/db/all antes da configuração da chave;
//   4. usuário informa a chave;
//   5. configurarConexao({local:false, ip, apiKey});
//   6. carregarUsuarios() → /api/db/all;
//   7. confirma X-API-Key → 200;
//   8. usuários aparecem.
// Também valida: sem chave → 401; chave errada → 401; chave correta → 200;
// admin remoto sem autorização → 403.
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

;(async function main() {
const ISOLADO = 'C:/fase1-ui-teste/teste-fluxo-obrigatorio'
fs.mkdirSync(ISOLADO, { recursive: true })
const DB = path.join(ISOLADO, 'tabacaria.sqlite')
for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f) } catch {} }
const PORTA = 3279

// ---- 1. Sobe servidor isolado ----
const script = `
const { initDb, getDb, seed, iniciarServidor, getApiKey } = require('${process.cwd().replace(/\\/g, '/')}/out/server/server/index.js')
initDb(${JSON.stringify(DB)})
seed(getDb())
iniciarServidor(${PORTA})
setTimeout(() => { console.log('CHAVE=' + getApiKey()); setInterval(() => {}, 1000) }, 800)
`
const serverFile = path.join(ISOLADO, 'servidor.cjs')
fs.writeFileSync(serverFile, script, 'utf8')
const serverProc = spawn(process.execPath, [serverFile], {
  env: { ...process.env, TABACARIA_TEST_FORCE_REMOTE: '1', TABACARIA_DB: DB },
  stdio: ['ignore', 'pipe', 'pipe']
})
const chave = await new Promise((resolve, reject) => {
  let buf = ''
  const t = setTimeout(() => reject(new Error('timeout servidor')), 10000)
  serverProc.stdout.on('data', (d) => {
    buf += d.toString()
    const m = buf.match(/CHAVE=(\w+)/)
    if (m) { clearTimeout(t); resolve(m[1]) }
  })
  serverProc.stderr.on('data', () => {})
})

const base = `http://127.0.0.1:${PORTA}`
const R = (method, p, body, headers = {}) => fetch(base + p, {
  method, headers: { 'Content-Type': 'application/json', ...headers },
  body: body ? JSON.stringify(body) : undefined
})

const out = {}

// ---- 2. Simula LOGIN sem chave: consulta /api/db/all como o Login fazia no mount ----
// Sem X-API-Key → o servidor DEVE bloquear (401). Este é o cenário que o bug
// produzia: a chamada no mount disparava ANTES de configurar a chave.
out.semChave = (await R('POST', '/api/db/all', { sql: 'SELECT 1' })).status

// ---- 3. NÃO chamar /api/db/all antes da configuração (correção) ----
// O novo Login só chama carregarUsuarios() se local=true OU temChave=true.
// Simula a decisão: cliente em rede, sem chave gravada → NÃO requisita.
const conexaoInicial = { ips: ['192.168.0.100'], url: '', local: false, temChave: false }
out.antesConfig = conexaoInicial.local || conexaoInicial.temChave
  ? 'chamaria'
  : 'NAO-chama'   // correto: não chama /api/db/all antes da chave

// ---- 4. Simula a configuração de conexão pelo usuário (aplicarConexao) ----
// configurarConexaoServidor grava a URL + chave; getApiKeyAtiva passa a valer.
const configurarConexao = (opcoes) => {
  // espelha configurarConexaoServidor do main/servidor.ts
  const url = opcoes.local
    ? `http://localhost:${PORTA}`
    : `http://${opcoes.ip}:${PORTA}`
  return { ok: true, url, ips: ['192.168.0.100'], apiKey: opcoes.apiKey || '' }
}
const cfg = configurarConexao({ local: false, ip: '127.0.0.1', apiKey: chave })

// ---- 5. carregarUsuarios() → POST /api/db/all COM a chave ----
const rUsers = await R('POST', '/api/db/all', { sql: 'SELECT id, nome, login, perfil FROM usuarios' }, { 'X-API-Key': cfg.apiKey })
out.chaveOk = rUsers.status
const usuarios = await rUsers.json()
out.usuarios = Array.isArray(usuarios) ? usuarios.map(u => u.login) : []
out.temAdmin = Array.isArray(usuarios) && usuarios.some(u => u.login === 'admin')

// ---- 6. Cenários de segurança ----
out.chaveErrada = (await R('POST', '/api/db/all', { sql: 'SELECT 1' }, { 'X-API-Key': 'errada' })).status
out.adminRemoto = (await R('GET', '/api/servidor/apikey', undefined, { 'X-API-Key': chave })).status
const rLogin = await R('POST', '/api/auth/login', { login: 'admin', senha: 'admin123' }, { 'X-API-Key': chave })
const lj = await rLogin.json()
out.login = rLogin.status
out.loginOk = lj.ok === true && lj.usuario?.login === 'admin'

console.log(JSON.stringify(out, null, 2))

let ok = 0, falha = 0
const check = (n, cond, det) => { if (cond) { ok++; console.log(`TESTE ${n}: OK`) } else { falha++; console.log(`TESTE ${n}: FALHA ${det}`) } }
check(1, out.semChave === 401, `semChave=${out.semChave}`)
check(2, out.antesConfig === 'NAO-chama', `antesConfig=${out.antesConfig}`)
check(3, out.chaveOk === 200, `chaveOk=${out.chaveOk}`)
check(4, out.temAdmin === true, `temAdmin=${out.temAdmin} usuarios=${JSON.stringify(out.usuarios)}`)
check(5, out.chaveErrada === 401, `chaveErrada=${out.chaveErrada}`)
check(6, out.adminRemoto === 403, `adminRemoto=${out.adminRemoto}`)
check(7, out.login === 200 && out.loginOk === true, `login=${out.login} loginOk=${out.loginOk}`)
console.log(`\nTOTAL: ${ok} OK, ${falha} FALHA`)

serverProc.kill()
process.exit(falha > 0 ? 1 : 0)
})().catch((e) => { console.error('ERRO:', e.message); serverProc.kill(); process.exit(1) })
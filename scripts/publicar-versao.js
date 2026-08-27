// Publica uma nova versão: builda app + servidor + instalador, monta release/ e gera manifest.json.
// Uso: node scripts/publicar-versao.js [nova-versao]
// Opções via arquivo release/notas.txt (notas da versão) e env TABACARIA_OBRIGATORIA=1
const { execSync } = require('node:child_process')
const { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, statSync } = require('node:fs')
const { join } = require('node:path')
const { createHash } = require('node:crypto')

const raiz = process.cwd()
const pkgPath = join(raiz, 'package.json')

function sha256(caminho) {
  return createHash('sha256').update(readFileSync(caminho)).digest('hex')
}

function rodar(cmd) {
  console.log(`\n>> ${cmd}`)
  execSync(cmd, { stdio: 'inherit', shell: process.platform === 'win32' ? 'powershell' : true })
}

async function main() {
  const somenteMontar = process.argv.includes('--montar-only')
  const novaVersao = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && !/^https?:$/.test(a) && !(process.argv[i - 1] || '').startsWith('--'))
  // Canal GitHub: --repo dono/repo --tag vX.Y.Z [--rollback]
  const idxRepo = process.argv.indexOf('--repo')
  const idxTag = process.argv.indexOf('--tag')
  const repo = idxRepo > 0 ? process.argv[idxRepo + 1] : null
  const tag = idxTag > 0 ? process.argv[idxTag + 1] : null
  const rollbackFlag = process.argv.includes('--rollback')
  if (!somenteMontar && novaVersao) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    pkg.version = novaVersao
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
    console.log(`[publicar] Versão atualizada para ${novaVersao}`)
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const versao = pkg.version
  console.log(`[publicar] Publicando versão ${versao}${somenteMontar ? ' (somente montagem)' : ''}`)

  // 1. Builds
  if (!somenteMontar) {
    rodar('npm.cmd run package:setup')
  }

  // 2. Monta release/
  const release = join(raiz, 'release')
  mkdirSync(release, { recursive: true })

  const artefatos = [
    { origem: join(raiz, 'dist-setup', 'NossoSistema-Setup.exe'), nome: 'NossoSistema-Setup.exe' }
  ]

  const manifest = {
    versao,
    baixar: 'NossoSistema-Setup.exe',
    tamanho: 0,
    sha256: '',
    obrigatoria: process.env.TABACARIA_OBRIGATORIA === '1',
    rollback: rollbackFlag,
    notas: []
  }

  const resumo = []
  for (const a of artefatos) {
    if (!existsSync(a.origem)) {
      console.warn(`[publicar] AVISO: artefato não encontrado: ${a.origem}`)
      continue
    }
    const destino = join(release, a.nome)
    copyFileSync(a.origem, destino)
    const tamanho = statSync(destino).size
    const hash = sha256(destino)
    resumo.push({ nome: a.nome, tamanho, sha256: hash })
    if (a.nome === manifest.baixar) {
      manifest.tamanho = tamanho
      manifest.sha256 = hash
    }
    console.log(`[publicar] ${a.nome} (${(tamanho / 1024 / 1024).toFixed(1)} MB)`)
  }

  // 3. Notas da versão
  const notasFile = join(release, 'notas.txt')
  if (existsSync(notasFile)) {
    manifest.notas = readFileSync(notasFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  } else {
    manifest.notas = [`Nova versão ${versao} do sistema.`]
  }

  // 4. Canal GitHub Releases: "baixar" vira URL absoluta (HTTPS) do asset.
  if (repo && tag) {
    manifest.baixar = `https://github.com/${repo}/releases/download/${tag}/${manifest.baixar}`
    manifest.url = `https://github.com/${repo}/releases/tag/${tag}`
  }

  writeFileSync(join(release, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  console.log('\n[publicar] release/manifest.json gerado:')
  console.log(JSON.stringify(manifest, null, 2))

  // 4. Instruções
  console.log('\n================== PUBLICAR ==================')
  console.log('Envie o conteúdo de release/ para o canal de atualização.')
  console.log('No servidor/cliente, configure o canal:')
  console.log('  - env TABACARIA_UPDATE_URL, ou')
  console.log('  - arquivo %APPDATA%\\sistema-loja-tabacaria\\update.url')
  console.log('==============================================')
}

main().catch((e) => {
  console.error('[publicar] Falha:', e)
  process.exit(1)
})
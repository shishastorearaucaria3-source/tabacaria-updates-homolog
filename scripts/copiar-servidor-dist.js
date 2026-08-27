// Copia Sistema Loja Tabacaria.exe → NossoSistema-Servidor.exe e altera o
// ícone para servidor.ico. O binário é o mesmo, mas com nome e ícone próprios
// (o app auto-detecta o modo servidor pelo nome "NossoSistema-Servidor").
const { copyFileSync, existsSync, statSync } = require('node:fs')
const { join } = require('node:path')
const { rcedit } = require('rcedit')

const distDir = join(process.cwd(), 'dist-final', 'win-unpacked')
const srcExe = join(distDir, 'Sistema Loja Tabacaria.exe')
const srvExe = join(distDir, 'NossoSistema-Servidor.exe')
const srvIcon = join(process.cwd(), 'build', 'icones', 'servidor.ico')

if (!existsSync(srcExe)) {
  console.error('[build] Fonte não encontrada:', srcExe)
  process.exit(1)
}
if (!existsSync(srvIcon)) {
  console.error('[build] servidor.ico não encontrado:', srvIcon)
  process.exit(1)
}

// Remove cópia antiga (Servidor.exe) para não deixar executável duplicado.
const exeAntigo = join(distDir, 'Servidor.exe')
if (existsSync(exeAntigo)) {
  try { require('node:fs').rmSync(exeAntigo, { force: true }) } catch { /* ignore */ }
  console.log('[build] Servidor.exe antigo removido (substituído por NossoSistema-Servidor.exe)')
}

copyFileSync(srcExe, srvExe)
console.log('[build] Copiado: Sistema Loja Tabacaria.exe → NossoSistema-Servidor.exe')

rcedit(srvExe, { icon: srvIcon })
  .then(() => {
    console.log('[build] Ícone do NossoSistema-Servidor.exe atualizado para servidor.ico')
    const stats = statSync(srvExe)
    console.log('[build] NossoSistema-Servidor.exe pronto:', srvExe, `(${(stats.size / 1024 / 1024).toFixed(1)} MB)`)
  })
  .catch((e) => {
    console.warn('[build] Aviso: falha ao alterar ícone:', e.message)
    console.log('[build] NossoSistema-Servidor.exe mantém ícone do NossoSistema')
  })

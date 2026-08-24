import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

function caminhoLogServidor(): string {
  return join(
    process.env.APPDATA || join(process.env.USERPROFILE || '.', 'AppData', 'Roaming'),
    'sistema-loja-tabacaria',
    'servidor-inicio.log'
  )
}

export function gravarLogServidor(m: string): void {
  try {
    writeFileSync(caminhoLogServidor(), `${new Date().toISOString()} ${m}\n`, { flag: 'a' })
  } catch { /* ignore */ }
}

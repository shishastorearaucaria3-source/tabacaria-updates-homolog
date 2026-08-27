import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { getLogFilePath } from '../shared/data-dir'

export function gravarLogServidor(m: string): void {
  try {
    const file = getLogFilePath()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${new Date().toISOString()} ${m}\n`, { flag: 'a' })
  } catch { /* ignore */ }
}

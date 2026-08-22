// Copia o index.html do servidor-exe para a pasta compilada (out/servidor-exe/servidor-exe)
const { copyFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const origem = join(process.cwd(), 'src', 'servidor-exe', 'index.html')
const destinoDir = join(process.cwd(), 'out', 'servidor-exe', 'servidor-exe')
const destino = join(destinoDir, 'index.html')

mkdirSync(destinoDir, { recursive: true })
copyFileSync(origem, destino)
console.log('[build] index.html do servidor copiado para out/servidor-exe/servidor-exe/')
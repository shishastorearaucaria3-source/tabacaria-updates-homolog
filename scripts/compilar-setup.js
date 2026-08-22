// Copia o index.html e o styles.css do setup-launcher para a pasta compilada
const { copyFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const origemDir = join(process.cwd(), 'src', 'setup-launcher')
const destinoDir = join(process.cwd(), 'out', 'setup-launcher')

mkdirSync(destinoDir, { recursive: true })
copyFileSync(join(origemDir, 'index.html'), join(destinoDir, 'index.html'))
copyFileSync(join(origemDir, 'styles.css'), join(destinoDir, 'styles.css'))
copyFileSync(join(origemDir, 'renderer.js'), join(destinoDir, 'renderer.js'))
console.log('[build] UI do instalador copiada para out/setup-launcher/')
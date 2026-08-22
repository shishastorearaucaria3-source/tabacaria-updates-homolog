const sharp = require('sharp')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const dir = join(process.cwd(), 'build', 'icones')
mkdirSync(dir, { recursive: true })

async function render(svg, nome) {
  const buf = await sharp(Buffer.from(svg), { density: 96 })
    .resize(256, 256)
    .png()
    .toBuffer()
  writeFileSync(join(dir, nome), buf)
  console.log('[icones] gerado build/icones/' + nome)
}

const tamanho = 256
const r = 54

// Ícone do SISTEMA: fundo verde com "S" branco (loja)
const svgSistema = `<svg width="${tamanho}" height="${tamanho}" xmlns="http://www.w3.org/2000/svg">
<defs>
  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#22c55e"/>
    <stop offset="1" stop-color="#15803d"/>
  </linearGradient>
</defs>
<rect x="8" y="8" width="240" height="240" rx="${r}" fill="url(#g)"/>
<path d="M78 96 Q78 58 128 58 Q180 58 180 100 Q180 132 140 140 Q100 148 92 168 Q86 186 96 200" stroke="#fff" stroke-width="22" stroke-linecap="round" fill="none"/>
<circle cx="96" cy="200" r="14" fill="#fff"/>
</svg>`

// Ícone do SERVIDOR: fundo azul-escuro com ícone de servidor (racks)
const svgServidor = `<svg width="${tamanho}" height="${tamanho}" xmlns="http://www.w3.org/2000/svg">
<defs>
  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#3b82f6"/>
    <stop offset="1" stop-color="#1d4ed8"/>
  </linearGradient>
</defs>
<rect x="8" y="8" width="240" height="240" rx="${r}" fill="url(#g)"/>
<rect x="52" y="52" width="152" height="64" rx="14" fill="#0f172a" opacity="0.95"/>
<rect x="52" y="140" width="152" height="64" rx="14" fill="#0f172a" opacity="0.95"/>
<circle cx="74" cy="84" r="7" fill="#22c55e"/>
<circle cx="74" cy="172" r="7" fill="#22c55e"/>
<circle cx="100" cy="84" r="7" fill="#f59e0b"/>
<circle cx="100" cy="172" r="7" fill="#f59e0b"/>
<circle cx="126" cy="84" r="7" fill="#ef4444"/>
<circle cx="126" cy="172" r="7" fill="#ef4444"/>
<rect x="148" y="76" width="40" height="16" rx="5" fill="#334155"/>
<rect x="148" y="164" width="40" height="16" rx="5" fill="#334155"/>
</svg>`

render(svgSistema, 'sistema.png')
render(svgServidor, 'servidor.png')
export interface ManifestoAtualizacao {
  versao: string
  baixar: string
  tamanho: number
  sha256: string
  obrigatoria: boolean
  rollback: boolean
  notas: string[]
  url?: string
}

// Compara versões semver "x.y.z". Retorna negativo se a < b, 0 se igual, positivo se a > b.
export function compararVersoes(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0
    const vb = pb[i] ?? 0
    if (va !== vb) return va - vb
  }
  return 0
}

// Regra de decisão de atualização:
//   versão maior            → atualiza (normal)
//   versão igual            → nada
//   versão menor            → só atualiza (downgrade) se rollback === true
export function deveAtualizar(atual: string, nova: string, rollback: boolean): boolean {
  const c = compararVersoes(nova, atual)
  if (c > 0) return true
  if (c === 0) return false
  return rollback === true
}

// Endereços locais/LAN: seguem a arquitetura atual (API LAN continua HTTP).
// Só o canal EXTERNO de atualização exige HTTPS.
export function ehEnderecoLocal(host: string): boolean {
  const h = String(host || '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1') return true
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  if (a === 127 || a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 169 && b === 254) return true
  return false
}

// URL válida para o canal/download de atualização:
//   https://        → sempre permitido
//   http://         → somente localhost/LAN
//   outros esquemas → nunca
export function urlCanalValida(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol === 'https:') return true
    if (u.protocol === 'http:') return ehEnderecoLocal(u.hostname)
    return false
  } catch {
    return false
  }
}

// Campo "baixar": nome simples de arquivo (relativo ao canal) OU URL absoluta
// permitida (GitHub Releases usa URL absoluta). Bloqueia travessia de caminho
// e esquemas inseguros.
function validarBaixar(valor: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(valor)) {
    return urlCanalValida(valor) ? valor : null
  }
  if (!valor || valor.includes('/') || valor.includes('\\') || valor.includes('..')) return null
  return valor
}

export function validarManifesto(dados: unknown): ManifestoAtualizacao | null {
  if (!dados || typeof dados !== 'object') return null
  const d = dados as Record<string, unknown>
  if (typeof d.versao !== 'string' || !/^\d+\.\d+\.\d+/.test(d.versao)) return null
  const baixar = typeof d.baixar === 'string' ? validarBaixar(d.baixar.trim()) : null
  if (!baixar) return null
  return {
    versao: d.versao,
    baixar,
    tamanho: Number(d.tamanho) || 0,
    sha256: typeof d.sha256 === 'string' ? d.sha256.toLowerCase() : '',
    obrigatoria: d.obrigatoria === true,
    rollback: d.rollback === true,
    notas: Array.isArray(d.notas) ? d.notas.filter((n) => typeof n === 'string') : [],
    url: typeof d.url === 'string' ? d.url : undefined
  }
}

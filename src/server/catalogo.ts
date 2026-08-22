import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { getDb } from './index'

export interface CatalogoConfig {
  github_token: string
  github_repo: string
  github_branch: string
  site_url: string
  nome_loja: string
}

function configPadrao(): CatalogoConfig {
  return {
    github_token: '',
    github_repo: '',
    github_branch: 'gh-pages',
    site_url: '',
    nome_loja: 'Minha Loja'
  }
}

export function getConfig(): CatalogoConfig {
  const cfg = configPadrao()
  const db = getDb()
  const nomeLoja = db.prepare(`SELECT valor FROM config WHERE chave = 'nome_loja'`).get() as { valor: string | null } | undefined
  if (nomeLoja?.valor) cfg.nome_loja = nomeLoja.valor
  try {
    const raw = db.prepare(`SELECT valor FROM catalogo_sync WHERE chave = 'config'`).get() as { valor: string } | undefined
    if (raw?.valor) Object.assign(cfg, JSON.parse(raw.valor))
  } catch { /* ignore */ }
  return cfg
}

export function salvarConfig(parcial: Partial<CatalogoConfig>): CatalogoConfig {
  const db = getDb()
  const atual = getConfig()
  const novo = { ...atual, ...parcial }
  db.prepare(`INSERT INTO catalogo_sync (chave, valor) VALUES ('config', ?)
              ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`)
    .run(JSON.stringify(novo))
  return novo
}

function setSync(chave: string, valor: string): void {
  const db = getDb()
  db.prepare(`INSERT INTO catalogo_sync (chave, valor) VALUES (?, ?)
              ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`)
    .run(chave, valor)
}

function getSync(chave: string): string {
  const db = getDb()
  const r = db.prepare(`SELECT valor FROM catalogo_sync WHERE chave = ?`).get(chave) as { valor: string | null } | undefined
  return r?.valor ?? ''
}

const LOCK_TIMEOUT_MS = 10 * 60 * 1000

function adquirirLock(): boolean {
  const db = getDb()
  const agora = Date.now()
  const atual = db.prepare(`SELECT valor FROM catalogo_sync WHERE chave = 'lock'`).get() as { valor: string | null } | undefined
  if (atual?.valor) {
    const ts = Number(atual.valor)
    if (!isNaN(ts) && agora - ts < LOCK_TIMEOUT_MS) {
      return false
    }
  }
  db.prepare(`INSERT INTO catalogo_sync (chave, valor) VALUES ('lock', ?)
              ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`)
    .run(String(agora))
  return true
}

function liberarLock(): void {
  try {
    getDb().prepare(`DELETE FROM catalogo_sync WHERE chave = 'lock'`).run()
  } catch { /* ignore */ }
}

function marcarProdutoAlterado(produtoId: number): void {
  const db = getDb()
  db.prepare(`UPDATE produtos SET alterado_em = datetime('now') WHERE id = ?`).run(produtoId)
  db.prepare(`INSERT INTO catalogo_fila (produto_id) VALUES (?)`).run(produtoId)
}

export function notificarAlteracaoProduto(produtoId: number): void {
  try {
    marcarProdutoAlterado(produtoId)
  } catch { /* ignore */ }
}

export async function temInternet(): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 6000)
    const res = await fetch('https://api.github.com/zen', { signal: ctrl.signal })
    clearTimeout(timer)
    return res.ok
  } catch {
    return false
  }
}

export interface ProdutoPublico {
  id: number
  nome: string
  codigo: string | null
  categoria: string | null
  subcategoria: string | null
  descricao: string | null
  marca: string | null
  preco: number
  preco_promo: number | null
  tem_promo: boolean
  disponivel: boolean
  estoque: number
  ordem: number
  imagem: string | null
}

export interface ExibicaoConfig {
  mostrar_estoque: boolean
  sem_estoque: 'despublicar' | 'manter'
  aceitar_pedidos_sem_estoque: boolean
  destacar_promocoes: boolean
}

function exibicaoPadrao(): ExibicaoConfig {
  return {
    mostrar_estoque: true,
    sem_estoque: 'despublicar',
    aceitar_pedidos_sem_estoque: false,
    destacar_promocoes: true
  }
}

function pegarConfig(chave: string): string {
  try {
    const db = getDb()
    const r = db.prepare(`SELECT valor FROM config WHERE chave = ?`).get(chave) as { valor: string | null } | undefined
    return r?.valor ?? ''
  } catch { return '' }
}

export function getExibicao(): ExibicaoConfig {
  const d = exibicaoPadrao()
  const mostrar = pegarConfig('catalogo_mostrar_estoque')
  const sem = pegarConfig('catalogo_sem_estoque')
  const aceitar = pegarConfig('catalogo_aceitar_sem_estoque')
  const destacar = pegarConfig('catalogo_destacar_promo')
  if (mostrar !== '') d.mostrar_estoque = mostrar === '1'
  if (sem === 'manter') d.sem_estoque = 'manter'
  if (aceitar !== '') d.aceitar_pedidos_sem_estoque = aceitar === '1'
  if (destacar !== '') d.destacar_promocoes = destacar === '1'
  return d
}

export function salvarExibicao(cfg: Partial<ExibicaoConfig>): ExibicaoConfig {
  const atual = getExibicao()
  const novo: ExibicaoConfig = {
    mostrar_estoque: typeof cfg.mostrar_estoque === 'boolean' ? cfg.mostrar_estoque : atual.mostrar_estoque,
    sem_estoque: cfg.sem_estoque === 'manter' ? 'manter' : 'despublicar',
    aceitar_pedidos_sem_estoque: typeof cfg.aceitar_pedidos_sem_estoque === 'boolean' ? cfg.aceitar_pedidos_sem_estoque : atual.aceitar_pedidos_sem_estoque,
    destacar_promocoes: typeof cfg.destacar_promocoes === 'boolean' ? cfg.destacar_promocoes : atual.destacar_promocoes
  }
  const db = getDb()
  const gravar = (chave: string, valor: string) =>
    db.prepare(`INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`).run(chave, valor)
  gravar('catalogo_mostrar_estoque', novo.mostrar_estoque ? '1' : '0')
  gravar('catalogo_sem_estoque', novo.sem_estoque)
  gravar('catalogo_aceitar_sem_estoque', novo.aceitar_pedidos_sem_estoque ? '1' : '0')
  gravar('catalogo_destacar_promo', novo.destacar_promocoes ? '1' : '0')
  return novo
}

export function gerarDadosPublicos(): ProdutoPublico[] {
  const db = getDb()
  const exib = getExibicao()
  const rows = db.prepare(
    `SELECT p.id, p.nome, COALESCE(p.codigo_interno, p.codigo_barras) AS codigo,
            c.nome AS categoria, s.nome AS subcategoria, p.descricao,
            m.nome AS marca,
            p.preco_venda AS preco, p.preco_promo, p.promocional,
            p.estoque, p.catalogo_ordem AS ordem, p.ativo, p.catalogo_publicado,
            (p.imagem IS NOT NULL AND length(p.imagem) > 0) AS tem_imagem
     FROM produtos p
     LEFT JOIN categorias c ON c.id = p.categoria_id
     LEFT JOIN subcategorias s ON s.id = p.subcategoria_id
     LEFT JOIN marcas m ON m.id = p.marca_id
     WHERE p.ativo = 1 AND p.catalogo_publicado = 1
     ORDER BY p.catalogo_ordem, p.nome`
  ).all() as unknown as {
    id: number; nome: string; codigo: string | null; categoria: string | null; subcategoria: string | null;
    descricao: string | null; marca: string | null; preco: number; preco_promo: number | null; promocional: number;
    estoque: number; ordem: number; ativo: number; catalogo_publicado: number; tem_imagem: number
  }[]
  const lista = rows.map((r) => ({
    id: r.id,
    nome: r.nome,
    codigo: r.codigo,
    categoria: r.categoria,
    subcategoria: r.subcategoria,
    descricao: r.descricao,
    marca: r.marca,
    preco: r.preco,
    preco_promo: r.promocional ? r.preco_promo : null,
    tem_promo: !!(r.promocional && r.preco_promo && r.preco_promo > 0),
    disponivel: r.estoque > 0,
    estoque: r.estoque,
    ordem: r.ordem,
    imagem: r.tem_imagem ? `imagens/${r.id}.jpg` : null
  }))
  // Regra "despublicar ao zerar estoque": filtra itens sem estoque do catálogo público
  if (exib.sem_estoque === 'despublicar') {
    return lista.filter((p) => p.estoque > 0)
  }
  return lista
}

export async function gerarSiteEstatico(produtos: ProdutoPublico[], cfg: CatalogoConfig): Promise<Record<string, string | Buffer>> {
  const categorias = [...new Set(produtos.map((p) => p.categoria).filter((x): x is string => !!x))].sort()
  const agora = new Date().toISOString()

  // Dados da loja (reais)
  const db = getDb()
  const pegar = (chave: string): string => {
    const r = db.prepare(`SELECT valor FROM config WHERE chave = ?`).get(chave) as { valor: string | null } | undefined
    return r?.valor ?? ''
  }
  interface ZonaPublica { id: number; nome: string; preco: number; poligono: { lat: number; lng: number }[] }
  const loja: {
    nome: string
    telefone: string
    endereco: string
    horario: string
    aceita_entrega: boolean
    aceita_retirada: boolean
    taxa_entrega: number
    loja_lat: number | null
    loja_lng: number | null
    pedidos_ativos: boolean
    manutencao_ativos: boolean
    zonas: ZonaPublica[]
  } = {
    nome: cfg.nome_loja,
    telefone: pegar('telefone_loja'),
    endereco: pegar('endereco_loja'),
    horario: pegar('horario_funcionamento'),
    aceita_entrega: pegar('aceita_entrega') === '0' ? false : true,
    aceita_retirada: pegar('aceita_retirada') === '1',
    taxa_entrega: Number(pegar('taxa_entrega')) || 0,
    loja_lat: Number(pegar('loja_lat')) || null,
    loja_lng: Number(pegar('loja_lng')) || null,
    pedidos_ativos: pegar('pedidos_ativos') === '0' ? false : true,
    manutencao_ativos: pegar('manutencao_ativos') === '1',
    zonas: []
  }
  try {
    const zonaRows = db.prepare(`SELECT id, nome, preco, poligono FROM zonas_entrega WHERE ativo = 1 ORDER BY nome`).all() as { id: number; nome: string; preco: number; poligono: string }[]
    loja.zonas = zonaRows.map((z) => {
      let poligono: { lat: number; lng: number }[] = []
      try { poligono = JSON.parse(z.poligono) } catch { poligono = [] }
      return { id: z.id, nome: z.nome, preco: z.preco, poligono }
    })
  } catch { /* sem zonas */ }

  const dadosEmbed = JSON.stringify({ loja, categorias, produtos })
  const exibicao = getExibicao()

  const json = JSON.stringify({ loja: cfg.nome_loja, atualizado_em: agora, categorias, produtos, exibicao }, null, 2)

  // dados.js separado: mantém o index.html leve e permite cache do navegador
  const dadosJs = `window.DADOS = ${dadosEmbed};\nwindow.EXIBICAO = ${JSON.stringify(exibicao)};`

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${cfg.nome_loja.replace(/</g, '&lt;')} — Catálogo</title>
<style>
:root{--brand:#16a34a;--brand-d:#15803d;--brand-l:#dcfce7;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--bg:#f8fafc;--card:#fff;--warn:#dc2626;--raio:14px}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased}
button{font-family:inherit;cursor:pointer;border:none;background:none}
input,select{font-family:inherit}

/* Header */
.topbar{position:sticky;top:0;z-index:40;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.topbar-in{max-width:1240px;margin:0 auto;padding:10px 16px;display:flex;align-items:center;gap:12px}
.brand{display:flex;align-items:center;gap:10px;min-width:0}
.brand .logo{width:40px;height:40px;border-radius:10px;background:var(--brand);color:#fff;font-weight:800;font-size:20px;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
.brand .nome-loja{font-weight:800;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.brand .sub{font-size:11px;color:var(--muted)}
.busca{flex:1;max-width:560px;position:relative;margin:0 auto}
.busca input{width:100%;padding:11px 14px 11px 40px;border:1px solid var(--line);border-radius:24px;font-size:14px;outline:none;background:#fff}
.busca input:focus{border-color:var(--brand);box-shadow:0 0 0 3px rgba(22,163,74,.15)}
.busca .lupa{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--muted);pointer-events:none}
.cart-btn{position:relative;display:flex;align-items:center;gap:8px;background:var(--ink);color:#fff;padding:10px 16px;border-radius:24px;font-weight:700;font-size:14px;white-space:nowrap}
.cart-btn:hover{background:#1e293b}
.cart-btn .badge{position:absolute;top:-6px;right:-6px;background:var(--warn);color:#fff;border-radius:50%;min-width:20px;height:20px;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;padding:0 5px}
.cart-btn.tem{background:var(--brand)}
.cart-btn.tem:hover{background:var(--brand-d)}
.info-btn{flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:40px;height:40px;border:1px solid var(--line);border-radius:10px;color:var(--muted)}
.info-btn:hover{background:#f1f5f9}

/* Layout */
.layout{max-width:1240px;margin:0 auto;padding:16px;display:grid;grid-template-columns:250px 1fr;gap:20px;align-items:start}

/* Sidebar */
.sidebar{position:sticky;top:76px;max-height:calc(100vh - 92px);overflow-y:auto;background:var(--card);border:1px solid var(--line);border-radius:var(--raio);padding:12px}
.sidebar h3{font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);padding:8px 10px}
.cat-item{display:flex;align-items:center;justify-content:space-between;width:100%;text-align:left;padding:9px 10px;border-radius:10px;font-size:14px;color:var(--ink);gap:8px}
.cat-item:hover{background:#f1f5f9}
.cat-item.ativa{background:var(--brand-l);color:var(--brand-d);font-weight:700}
.cat-item .count{font-size:12px;color:var(--muted);background:#f1f5f9;border-radius:10px;padding:1px 8px}
.cat-item.ativa .count{background:var(--brand);color:#fff}

/* Filtros topo (mobile chips) */
.chips{display:none;overflow-x:auto;gap:8px;padding:4px 0;margin-bottom:10px;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.chips::-webkit-scrollbar{display:none}
.chip{flex:0 0 auto;padding:8px 14px;border-radius:20px;border:1px solid var(--line);font-size:13px;white-space:nowrap;background:#fff}
.chip.ativa{background:var(--brand);color:#fff;border-color:var(--brand)}

/* Toolbar conteúdo */
.content-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.content-head h2{font-size:20px;font-weight:800;flex:1}
.resultado-count{font-size:13px;color:var(--muted)}
.ordenar{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted)}
.ordenar select{padding:8px 10px;border:1px solid var(--line);border-radius:10px;font-size:13px;background:#fff;color:var(--ink)}

/* Grid */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--raio);overflow:hidden;display:flex;flex-direction:column;transition:box-shadow .15s,border-color .15s}
.card:hover{box-shadow:0 8px 24px rgba(15,23,42,.08);border-color:#cbd5e1}
.foto{position:relative;aspect-ratio:1;background:linear-gradient(135deg,#f1f5f9,#e9eef5);display:flex;align-items:center;justify-content:center}
.foto img{width:100%;height:100%;object-fit:cover}
.sem-foto{font-size:44px;opacity:.85}
.promo-badge{position:absolute;top:8px;left:8px;background:var(--warn);color:#fff;font-size:11px;font-weight:800;padding:3px 8px;border-radius:6px}
.esgotado-badge{position:absolute;top:8px;right:8px;background:#334155;color:#fff;font-size:11px;font-weight:800;padding:3px 8px;border-radius:6px}
.card.sem-estoque .foto{opacity:.55}
.card.sem-estoque .preco{color:var(--muted)}
.estoque-linha{font-size:12px;color:var(--muted)}
.card-body{padding:12px;display:flex;flex-direction:column;gap:5px;flex:1}
.nome{font-size:14px;font-weight:700;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.marca{font-size:12px;color:var(--brand-d);font-weight:600}
.sku{font-size:11px;color:var(--muted)}
.precos{display:flex;align-items:baseline;gap:6px;margin-top:auto;padding-top:4px}
.preco-antigo{font-size:12px;color:var(--muted);text-decoration:line-through}
.preco{font-size:18px;font-weight:800;color:var(--ink)}
.preco.promo{color:var(--warn)}
.add-btn{margin-top:8px;width:100%;padding:10px;border-radius:10px;background:var(--brand);color:#fff;font-weight:700;font-size:14px;transition:background .15s,transform .1s}
.add-btn:hover{background:var(--brand-d)}
.add-btn:active{transform:scale(.97)}
.add-btn.added{background:#e2e8f0;color:var(--brand-d)}
.add-btn.sem{background:#f1f5f9;color:var(--muted);cursor:not-allowed}
.add-btn.disabled{background:#f1f5f9;color:var(--muted);cursor:not-allowed}
.vazio{text-align:center;padding:50px 20px;color:var(--muted)}
.vazio .ico{font-size:42px;margin-bottom:10px}
.vazio button{margin-top:12px;padding:10px 20px;border-radius:10px;background:var(--ink);color:#fff;font-weight:700}

/* Drawer carrinho */
.overlay{position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:60;display:none}
.overlay.aberto{display:block}
.drawer{position:fixed;top:0;right:0;bottom:0;width:400px;max-width:92vw;background:#fff;z-index:61;transform:translateX(100%);transition:transform .25s ease;display:flex;flex-direction:column}
.drawer.aberto{transform:none}
.drawer-head{display:flex;align-items:center;justify-content:space-between;padding:16px;border-bottom:1px solid var(--line)}
.drawer-head h2{font-size:18px;font-weight:800}
.fechar{width:34px;height:34px;border-radius:50%;background:#f1f5f9;color:var(--muted);font-size:16px}
.drawer-body{flex:1;overflow-y:auto;padding:16px}
.it-cart{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}
.it-cart .info{flex:1;min-width:0}
.it-cart .info .n{font-weight:600;font-size:14px;line-height:1.3}
.it-cart .info .p{font-size:13px;color:var(--muted);margin-top:2px}
.qtd{display:flex;align-items:center;gap:8px;margin-top:6px}
.qtd button{width:28px;height:28px;border-radius:50%;border:1px solid var(--line);background:#fff;font-weight:700;font-size:16px;line-height:1}
.qtd button:hover{background:#f1f5f9}
.qtd b{min-width:20px;text-align:center}
.it-cart .sub{font-weight:700;font-size:14px;white-space:nowrap}
.remover{color:var(--warn);font-size:12px;margin-top:6px;display:block}
.cart-vazio{text-align:center;padding:40px 20px;color:var(--muted)}
.cart-vazio .ico{font-size:42px;margin-bottom:10px}
.drawer-foot{border-top:1px solid var(--line);padding:16px}
.drawer-foot .linha{display:flex;justify-content:space-between;margin-bottom:6px;font-size:14px}
.drawer-foot .linha.total{font-size:18px;font-weight:800;border-top:1px solid var(--line);padding-top:10px;margin-top:8px}
.finalizar{width:100%;padding:14px;border-radius:12px;background:var(--brand);color:#fff;font-weight:800;font-size:16px;margin-top:10px}
.finalizar:hover{background:var(--brand-d)}

/* Modal infos */
.modal{position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:70;display:none;align-items:center;justify-content:center;padding:16px}
.modal.aberto{display:flex}
.modal-box{background:#fff;border-radius:var(--raio);padding:24px;width:100%;max-width:440px;max-height:90vh;overflow-y:auto}
.modal-box h2{margin-bottom:16px;font-size:20px;font-weight:800}
.info-linha{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--line);font-size:14px;align-items:flex-start}
.info-linha .t{color:var(--muted);width:90px;flex:0 0 auto}
.info-linha .v{flex:1}

/* Footer */
footer{border-top:1px solid var(--line);margin-top:30px;background:#fff}
.foot-in{max-width:1240px;margin:0 auto;padding:24px 16px;display:grid;grid-template-columns:1fr 1fr;gap:20px}
.foot-in h4{font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:8px}
.foot-in p,.foot-in a{font-size:13px;color:var(--muted);line-height:1.6;text-decoration:none;display:block}
.foot-in a:hover{color:var(--brand-d)}
.voltar-topo{position:fixed;bottom:20px;left:20px;z-index:50;width:46px;height:46px;border-radius:50%;background:var(--ink);color:#fff;font-size:20px;box-shadow:0 4px 12px rgba(0,0,0,.2);display:none}
.voltar-topo.visivel{display:flex;align-items:center;justify-content:center}

/* toast */
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(80px);background:var(--ink);color:#fff;padding:12px 20px;border-radius:12px;font-size:14px;font-weight:600;z-index:80;transition:transform .25s;opacity:0}
.toast.visivel{transform:translateX(-50%);opacity:1}

/* Checkout */
.checkout-sec{margin-top:14px;padding-top:14px;border-top:1px dashed var(--line)}
.checkout-sec h3{font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:10px}
.modo-btns{display:flex;gap:8px;margin-bottom:12px}
.modo-btn{flex:1;padding:11px;border-radius:12px;border:1.5px solid var(--line);background:#fff;font-weight:700;font-size:14px;color:var(--muted)}
.modo-btn.ativa{background:var(--brand);border-color:var(--brand);color:#fff}
.fld{margin-bottom:10px}
.fld label{display:block;font-size:12px;font-weight:600;color:var(--muted);margin-bottom:4px}
.fld input,.fld select{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:10px;font-size:14px;outline:none;background:#fff}
.fld input:focus,.fld select:focus{border-color:var(--brand);box-shadow:0 0 0 3px rgba(22,163,74,.15)}
.fld-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.fld .cep-linha{display:flex;gap:8px}
.fld .cep-linha input{flex:1}
.buscar-cep{white-space:nowrap;padding:11px 14px;border-radius:10px;background:var(--ink);color:#fff;font-weight:700;font-size:13px}
.buscar-cep:hover{background:#1e293b}
.zona-info{font-size:12px;color:var(--muted);margin-top:6px}
.zona-info.ok{color:var(--brand-d);font-weight:600}
.zona-info.err{color:var(--warn);font-weight:600}
.localizar{width:100%;margin-top:6px;padding:9px;border-radius:10px;border:1px solid var(--line);background:#f8fafc;color:var(--ink);font-weight:600;font-size:13px}
.localizar:hover{background:#f1f5f9}

/* Manutenção / pedidos desativados */
.aviso-pedidos{display:none;background:#fef3c7;color:#92400e;text-align:center;font-size:13px;font-weight:600;padding:8px 14px}
.aviso-pedidos.visivel{display:block}
.manutencao-overlay{position:fixed;inset:0;z-index:100;background:#f8fafc;display:none;align-items:center;justify-content:center;padding:20px;text-align:center}
.manutencao-overlay.visivel{display:flex}
.manutencao-box{max-width:420px}
.manutencao-box .logo-grande{width:72px;height:72px;border-radius:18px;background:var(--brand);color:#fff;font-size:36px;font-weight:800;display:flex;align-items:center;justify-content:center;margin:0 auto 18px}
.manutencao-box h2{font-size:22px;font-weight:800;margin-bottom:8px}
.manutencao-box p{color:var(--muted);font-size:14px;line-height:1.6}
.manutencao-box .contato{margin-top:16px;font-size:13px}

@media(max-width:860px){
  .layout{grid-template-columns:1fr;padding:12px}
  .sidebar{display:none}
  .chips{display:flex}
  .brand .sub{display:none}
  .cart-btn span{display:none}
  .cart-btn{padding:10px 14px}
  .grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
  .nome{font-size:13px}
  .preco{font-size:16px}
  .foot-in{grid-template-columns:1fr}
}
</style>
</head>
<body>
<div class="topbar">
  <div class="topbar-in">
    <div class="brand">
      <div class="logo" id="logo">S</div>
      <div>
        <div class="nome-loja" id="loja-nome">${cfg.nome_loja.replace(/</g, '&lt;')}</div>
        <div class="sub" id="loja-sub">Catálogo online</div>
      </div>
    </div>
    <div class="busca">
      <span class="lupa"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></span>
      <input id="busca" placeholder="Pesquisar por nome, código ou marca..." />
    </div>
    <button class="info-btn" onclick="abrirInfo()" title="Informações da loja">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M12 11v5"/></svg>
    </button>
    <button class="cart-btn" id="cart-btn" onclick="abrirCarrinho()">
      🛒 <span>Pedido</span> <span class="badge" id="badge" style="display:none">0</span>
    </button>
  </div>
</div>

<div class="layout">
  <aside class="sidebar" id="sidebar"></aside>

  <main>
    <div class="chips" id="chips"></div>
    <div class="content-head">
      <h2 id="titulo-categoria">Todos os produtos</h2>
      <span class="resultado-count" id="count"></span>
      <div class="ordenar">
        Ordenar
        <select id="ordenar">
          <option value="relevancia">Relevância</option>
          <option value="az">A-Z</option>
          <option value="za">Z-A</option>
          <option value="menor">Menor preço</option>
          <option value="maior">Maior preço</option>
        </select>
      </div>
    </div>
    <div class="grid" id="grid"></div>
    <div class="vazio" id="vazio" style="display:none">
      <div class="ico">🔍</div>
      <div><strong>Nenhum produto encontrado.</strong></div>
      <button onclick="limparBusca()">Limpar pesquisa</button>
    </div>
  </main>
</div>

<footer>
  <div class="foot-in">
    <div>
      <h4>${cfg.nome_loja.replace(/</g, '&lt;')}</h4>
      <p id="foot-endereco"></p>
      <p id="foot-horario"></p>
      <p id="foot-telefone"></p>
    </div>
    <div>
      <h4>Informações</h4>
      <a href="#" onclick="abrirInfo();return false;">Informações da loja</a>
      <a href="#" onclick="mostrarPolitica();return false;">Política de privacidade</a>
      <a href="#" onclick="voltarTopo();return false;">Voltar ao topo</a>
    </div>
  </div>
</footer>

<button class="voltar-topo" id="voltar-topo" onclick="voltarTopo()">↑</button>

<div class="overlay" id="overlay" onclick="fecharDrawers()"></div>

<div class="drawer" id="drawer">
  <div class="drawer-head">
    <h2>Seu pedido</h2>
    <button class="fechar" onclick="fecharCarrinho()">✕</button>
  </div>
  <div class="drawer-body" id="drawer-body"></div>
  <div class="drawer-foot" id="drawer-foot" style="display:none">
    <div class="linha"><span>Subtotal</span><span id="r-subtotal">R$ 0,00</span></div>
    <div class="linha" id="r-entrega-linha" style="display:none"><span id="r-entrega-lbl">Entrega</span><span id="r-entrega">R$ 0,00</span></div>
    <div class="linha total"><span>Total</span><span id="r-total">R$ 0,00</span></div>
    <button class="finalizar" onclick="finalizarPedido()">Continuar pedido</button>
  </div>
</div>

<div class="modal" id="modal-info">
  <div class="modal-box">
    <h2>Infos desta Loja</h2>
    <div class="info-linha"><span class="t">Nome</span><span class="v" id="info-nome"></span></div>
    <div class="info-linha"><span class="t">Endereço</span><span class="v" id="info-endereco"></span></div>
    <div class="info-linha"><span class="t">Horário</span><span class="v" id="info-horario"></span></div>
    <div class="info-linha"><span class="t">Telefone</span><span class="v" id="info-telefone"></span></div>
    <div class="info-linha"><span class="t">Pagamento</span><span class="v">Dinheiro, Pix, Cartão</span></div>
    <div style="margin-top:16px;text-align:right"><button class="finalizar" style="width:auto;padding:10px 22px" onclick="fecharInfo()">Fechar</button></div>
  </div>
</div>

<div class="modal" id="modal-politica">
  <div class="modal-box">
    <h2>Política de Privacidade</h2>
    <p style="font-size:14px;color:var(--muted);line-height:1.7">
      Os dados informados neste catálogo (nome e telefone, quando fornecidos para montagem do pedido)
      são utilizados exclusivamente para atender ao seu pedido e entrar em contato quando necessário.
      Não compartilhamos suas informações com terceiros. Ao utilizar o catálogo, você concorda com
      este uso. Para dúvidas, fale com a loja.
    </p>
    <div style="margin-top:16px;text-align:right"><button class="finalizar" style="width:auto;padding:10px 22px" onclick="fecharPolitica()">Entendi</button></div>
  </div>
</div>

<div class="toast" id="toast"></div>

<div class="aviso-pedidos" id="aviso-pedidos">⚠️ Pedidos temporariamente desativados — visite a loja ou fale conosco.</div>

<div class="manutencao-overlay" id="manutencao-overlay">
  <div class="manutencao-box">
    <div class="logo-grande" id="manut-logo">S</div>
    <h2 id="manut-titulo">Em manutenção</h2>
    <p id="manut-texto">Estamos atualizando o catálogo. Volte em instantes ou fale conosco pelo WhatsApp.</p>
    <div class="contato" id="manut-contato"></div>
  </div>
</div>

<script src="dados.js"></script>
<script>
const DADOS = window.DADOS;
const EXIBICAO = window.EXIBICAO || { mostrar_estoque:true, sem_estoque:'despublicar', aceitar_pedidos_sem_estoque:false, destacar_promocoes:true };

const estado = { produtos: DADOS.produtos, loja: DADOS.loja, categorias: DADOS.categorias, carrinho: {}, catAtiva: '', busca: '', ordem: 'relevancia', checkout: { modo: 'entrega', nome: '', whatsapp: '', cep: '', rua: '', numero: '', bairro: '', cidade: '', uf: '', zonaId: null, obs: '' } };

function fmt(v){ return v.toLocaleString('pt-BR', { style:'currency', currency:'BRL' }); }
function esc(s){ return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function pontoEmPoligono(lat, lng, poligono){
  let dentro = false;
  const pts = poligono || [];
  for(let i=0, j=pts.length-1; i<pts.length; j=i++){
    const xi = pts[i].lat, yi = pts[i].lng;
    const xj = pts[j].lat, yj = pts[j].lng;
    const cruza = yi > lng !== yj > lng && lat < ((xj-xi)*(lng-yi))/(yj-yi)+xi;
    if(cruza) dentro = !dentro;
  }
  return dentro;
}
function encontrarZona(lat, lng){
  const zonas = estado.loja.zonas || [];
  for(const z of zonas){
    if(z.poligono && pontoEmPoligono(lat, lng, z.poligono)) return z;
  }
  return null;
}
function zonaSelecionada(){
  const zonas = estado.loja.zonas || [];
  return zonas.find(z => z.id === estado.checkout.zonaId) || null;
}
function taxaAtual(){
  const zonas = estado.loja.zonas || [];
  const z = zonaSelecionada();
  if(estado.checkout.modo === 'retirada') return 0;
  if(z) return z.preco;
  if(zonas.length === 0) return estado.loja.taxa_entrega || 0;
  return null;
}

function carregarCarrinho(){
  try { const s = localStorage.getItem('catalogo_carrinho'); if(s) estado.carrinho = JSON.parse(s); } catch(e){}
}

function salvarCarrinho(){
  try { localStorage.setItem('catalogo_carrinho', JSON.stringify(estado.carrinho)); } catch(e){}
}

function contagens(){
  const m = {};
  for(const p of estado.produtos){ const c = p.categoria || 'Sem categoria'; m[c]=(m[c]||0)+1; }
  return m;
}

function renderizarSidebar(){
  const cont = contagens();
  const el = document.getElementById('sidebar');
  const total = estado.produtos.length;
  let h = '<h3>Categorias</h3>';
  h += '<button class="cat-item'+(estado.catAtiva===''?' ativa':'')+'" data-cat="" onclick="setCat(this.dataset.cat)"><span>Todos os produtos</span><span class="count">'+total+'</span></button>';
  h += '<button class="cat-item'+(estado.catAtiva==='__promo'?' ativa':'')+'" data-cat="__promo" onclick="setCat(this.dataset.cat)"><span>Promoções</span><span class="count">'+estado.produtos.filter(p=>p.tem_promo).length+'</span></button>';
  const cats = Object.keys(cont).sort();
  for(const c of cats){
    h += '<button class="cat-item'+(estado.catAtiva===c?' ativa':'')+'" data-cat="'+esc(c)+'" onclick="setCat(this.dataset.cat)"><span>'+esc(c)+'</span><span class="count">'+cont[c]+'</span></button>';
  }
  el.innerHTML = h;
  // chips mobile
  const chips = document.getElementById('chips');
  let ch = '<button class="chip'+(estado.catAtiva===''?' ativa':'')+'" data-cat="" onclick="setCat(this.dataset.cat)">Todos</button>';
  ch += '<button class="chip'+(estado.catAtiva==='__promo'?' ativa':'')+'" data-cat="__promo" onclick="setCat(this.dataset.cat)">Promoções</button>';
  for(const c of cats){ ch += '<button class="chip'+(estado.catAtiva===c?' ativa':'')+'" data-cat="'+esc(c)+'" onclick="setCat(this.dataset.cat)">'+esc(c)+'</button>'; }
  chips.innerHTML = ch;
}

function setCat(c){ estado.catAtiva = c; renderizarSidebar(); renderizar(); }

function listaFiltrada(){
  let l = estado.produtos.slice();
  if(estado.catAtiva === '__promo'){ l = l.filter(p=>p.tem_promo); }
  else if(estado.catAtiva){ l = l.filter(p=>p.categoria === estado.catAtiva); }
  const b = estado.busca.toLowerCase().trim();
  if(b){ l = l.filter(p => (p.nome||'').toLowerCase().includes(b) || (p.codigo||'').toLowerCase().includes(b) || (p.marca||'').toLowerCase().includes(b) || (p.descricao||'').toLowerCase().includes(b)); }
  const o = estado.ordem;
  if(o==='az') l.sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
  else if(o==='za') l.sort((a,b)=>b.nome.localeCompare(a.nome,'pt-BR'));
  else if(o==='menor') l.sort((a,b)=>(a.tem_promo&&a.preco_promo?a.preco_promo:a.preco)-(b.tem_promo&&b.preco_promo?b.preco_promo:b.preco));
  else if(o==='maior') l.sort((a,b)=>(b.tem_promo&&b.preco_promo?b.preco_promo:b.preco)-(a.tem_promo&&a.preco_promo?a.preco_promo:a.preco));
  else l.sort((a,b)=>(a.ordem||0)-(b.ordem||0));
  return l;
}

function renderizar(){
  const lista = listaFiltrada();
  const grid = document.getElementById('grid');
  const vazio = document.getElementById('vazio');
  const count = document.getElementById('count');
  const titulo = document.getElementById('titulo-categoria');
  count.textContent = lista.length + ' produto' + (lista.length===1?'':'s');
  titulo.textContent = estado.catAtiva === '__promo' ? 'Promoções' : (estado.catAtiva || 'Todos os produtos');
  if(!lista.length){ grid.innerHTML=''; vazio.style.display='block'; return; }
  vazio.style.display='none';
  grid.innerHTML = lista.map(p => {
    const promo = EXIBICAO.destacar_promocoes && p.tem_promo && p.preco_promo > 0;
    const preco = promo ? p.preco_promo : p.preco;
    const q = estado.carrinho[p.id] || 0;
    const semEstoque = !p.disponivel;
    const pedidosOff = estado.loja.pedidos_ativos === false;
    const podeComprar = !pedidosOff && (!semEstoque || (EXIBICAO.sem_estoque === 'manter' && EXIBICAO.aceitar_pedidos_sem_estoque));
    const addCls = semEstoque && !podeComprar ? 'add-btn disabled' : (q ? 'add-btn added' : 'add-btn');
    const addTxt = pedidosOff ? 'Indisponível' : (semEstoque && !podeComprar ? 'Sem estoque' : (q ? 'Adicionado ('+q+')' : 'Adicionar'));
    const btn = podeComprar
      ? '<button class="'+addCls+'" onclick="addProduto('+p.id+')">'+addTxt+'</button>'
      : '<button class="'+addCls+'" disabled>'+addTxt+'</button>';
    return '<div class="card'+(semEstoque?' sem-estoque':'')+'">'+
      '<div class="foto">'+
        (p.imagem ? '<img src="'+esc(p.imagem)+'" alt="'+esc(p.nome)+'" loading="lazy" />' : '<span class="sem-foto">🛍️</span>')+
        (promo ? '<span class="promo-badge">PROMO</span>' : '')+
        (semEstoque ? '<span class="esgotado-badge">Sem estoque</span>' : '')+
      '</div>'+
      '<div class="card-body">'+
        '<div class="nome">'+esc(p.nome)+'</div>'+
        (p.marca ? '<div class="marca">'+esc(p.marca)+'</div>' : '')+
        '<div class="sku">Cód. '+esc(p.codigo||'—')+'</div>'+
        (EXIBICAO.mostrar_estoque && !semEstoque ? '<div class="estoque-linha">Estoque: '+p.estoque+' unid.</div>' : '')+
        '<div class="precos">'+
          (promo ? '<span class="preco-antigo">'+fmt(p.preco)+'</span>' : '')+
          '<span class="preco'+(promo?' promo':'')+'">'+fmt(preco)+'</span>'+
        '</div>'+
        btn+
      '</div>'+
    '</div>';
  }).join('');
  atualizarCarrinhoUI();
}

function addProduto(id){
  estado.carrinho[id] = (estado.carrinho[id]||0)+1;
  salvarCarrinho();
  renderizar();
  toast('Adicionado ✓');
}

function mudarQtd(id, d){
  estado.carrinho[id] = (estado.carrinho[id]||0)+d;
  if(estado.carrinho[id]<=0) delete estado.carrinho[id];
  salvarCarrinho();
  renderizarCarrinho();
  renderizar();
}

function remover(id){ delete estado.carrinho[id]; salvarCarrinho(); renderizarCarrinho(); renderizar(); toast('Removido'); }

function total(){ let s=0; for(const [id,q] of Object.entries(estado.carrinho)){ const p = estado.produtos.find(x=>x.id===Number(id)); if(p){ s += (p.tem_promo&&p.preco_promo>0?p.preco_promo:p.preco)*q; } } return s; }

function atualizarCarrinhoUI(){
  const qtd = Object.values(estado.carrinho).reduce((s,q)=>s+q,0);
  const badge = document.getElementById('badge');
  const btn = document.getElementById('cart-btn');
  badge.style.display = qtd?'flex':'none';
  badge.textContent = qtd;
  btn.classList.toggle('tem', qtd>0);
}

function renderizarCarrinho(){
  const body = document.getElementById('drawer-body');
  const foot = document.getElementById('drawer-foot');
  const ids = Object.keys(estado.carrinho);
  if(!ids.length){
    body.innerHTML = '<div class="cart-vazio"><div class="ico">🛒</div><strong>Seu pedido está vazio</strong><div style="margin-top:6px;font-size:13px">Adicione produtos para começar.</div></div>';
    foot.style.display='none';
    return;
  }
  body.innerHTML = ids.map(id=>{
    const p = estado.produtos.find(x=>x.id===Number(id));
    if(!p) return '';
    const preco = p.tem_promo&&p.preco_promo>0?p.preco_promo:p.preco;
    const q = estado.carrinho[id];
    return '<div class="it-cart">'+
      '<div class="info">'+
        '<div class="n">'+esc(p.nome)+'</div>'+
        '<div class="p">'+fmt(preco)+' cada</div>'+
        '<div class="qtd"><button onclick="mudarQtd('+p.id+',-1)">−</button><b>'+q+'</b><button onclick="mudarQtd('+p.id+',1)">+</button></div>'+
        '<button class="remover" onclick="remover('+p.id+')">Remover</button>'+
      '</div>'+
      '<div class="sub">'+fmt(preco*q)+'</div>'+
    '</div>';
  }).join('');
  body.innerHTML += htmlCheckout();
  foot.style.display='block';
  atualizarResumo();
}

function htmlCheckout(){
  const l = estado.loja;
  const temEntrega = l.aceita_entrega !== false;
  const temRetirada = l.aceita_retirada === true;
  const zonas = l.zonas || [];
  const sel = zonaSelecionada();
  const entregaAtiva = estado.checkout.modo === 'entrega';
  let modoBtns = '';
  if(temRetirada && !temEntrega){
    modoBtns = '<button class="modo-btn ativa" onclick="setModo(\\'retirada\\')">🛍️ Retirada na loja</button>';
  } else if(temEntrega && !temRetirada){
    modoBtns = '<button class="modo-btn ativa" onclick="setModo(\\'entrega\\')">🛵 Entrega</button>';
  } else {
    modoBtns = '<button class="modo-btn'+(entregaAtiva?' ativa':'')+'" onclick="setModo(\\'entrega\\')">🛵 Entrega</button>'+
               '<button class="modo-btn'+(entregaAtiva?'':' ativa')+'" onclick="setModo(\\'retirada\\')">🛍️ Retirada</button>';
  }
  const optZonas = zonas.map(z=>'<option value="'+z.id+'"'+(z.id===estado.checkout.zonaId?' selected':'')+'>'+esc(z.nome)+' — '+fmt(z.preco)+'</option>').join('');
  const zonaCampo = zonas.length ? (
    '<div class="fld"><label>Zona de entrega</label>'+
    '<select id="ck-zona" onchange="mudarZona(this)">'+
    '<option value="">Selecione a zona...</option>'+optZonas+'</select>'+
    '<button class="localizar" type="button" onclick="buscarCep()">Localizar zona pelo CEP</button>'+
    '<div class="zona-info" id="ck-zona-info"></div>'+
    '</div>'
  ) : '';
  const entregaFields = entregaAtiva ? (
    '<div id="ck-entrega-fields">'+
      (zonaCampo)+
      '<div class="fld"><label>CEP</label><div class="cep-linha">'+
        '<input id="ck-cep" value="'+esc(estado.checkout.cep)+'" placeholder="00000-000" maxlength="9" oninput="estado.checkout.cep=this.value" onblur="if(this.value.length===9)buscarCep()"/>'+
        '<button class="buscar-cep" type="button" onclick="buscarCep()">Buscar</button>'+
      '</div></div>'+
      '<div class="fld"><label>Endereço (rua)</label><input id="ck-rua" value="'+esc(estado.checkout.rua)+'" placeholder="Rua" oninput="estado.checkout.rua=this.value"/></div>'+
      '<div class="fld-row">'+
        '<div class="fld"><label>Número</label><input id="ck-numero" value="'+esc(estado.checkout.numero)+'" placeholder="Nº" oninput="estado.checkout.numero=this.value"/></div>'+
        '<div class="fld"><label>Bairro</label><input id="ck-bairro" value="'+esc(estado.checkout.bairro)+'" placeholder="Bairro" oninput="estado.checkout.bairro=this.value"/></div>'+
      '</div>'+
      '<div class="fld-row">'+
        '<div class="fld"><label>Cidade</label><input id="ck-cidade" value="'+esc(estado.checkout.cidade)+'" placeholder="Cidade" oninput="estado.checkout.cidade=this.value"/></div>'+
        '<div class="fld"><label>UF</label><input id="ck-uf" value="'+esc(estado.checkout.uf)+'" placeholder="UF" maxlength="2" oninput="estado.checkout.uf=this.value"/></div>'+
      '</div>'+
    '</div>'
  ) : '<div id="ck-entrega-fields" style="display:none"></div>';
  return '<div class="checkout-sec">'+
    '<h3>Dados do pedido</h3>'+
    '<div class="fld"><label>Seu nome</label><input id="ck-nome" value="'+esc(estado.checkout.nome)+'" placeholder="Nome do cliente" oninput="estado.checkout.nome=this.value"/></div>'+
    '<div class="fld"><label>WhatsApp</label><input id="ck-whatsapp" value="'+esc(estado.checkout.whatsapp)+'" placeholder="(00) 00000-0000" oninput="estado.checkout.whatsapp=this.value"/></div>'+
    '<div class="fld"><label>Recebimento</label><div class="modo-btns">'+modoBtns+'</div></div>'+
    entregaFields+
    '<div class="fld"><label>Observações</label><input id="ck-obs" value="'+esc(estado.checkout.obs)+'" placeholder="Ex.: pagar no Pix, entregar no portão..." oninput="estado.checkout.obs=this.value"/></div>'+
  '</div>';
}

function mudarZona(el){
  const v = el.value;
  estado.checkout.zonaId = v === '' ? null : Number(v);
  const info = document.getElementById('ck-zona-info');
  if(info){ info.textContent = ''; info.className = 'zona-info'; }
  atualizarResumo();
}

function setModo(m){
  estado.checkout.modo = m;
  renderizarCarrinho();
  atualizarResumo();
}

async function buscarCep(){
  const cep = (document.getElementById('ck-cep')?.value || estado.checkout.cep || '').replace(/\D/g,'');
  const info = document.getElementById('ck-zona-info');
  if(cep.length !== 8){ if(info){info.textContent='Informe um CEP válido';info.className='zona-info err';} return; }
  if(info){info.textContent='Buscando CEP...';info.className='zona-info';}
  try{
    const r = await fetch('https://viacep.com.br/ws/'+cep+'/json/');
    const d = await r.json();
    if(d.erro){ if(info){info.textContent='CEP não encontrado';info.className='zona-info err';} return; }
    estado.checkout.cep = cep;
    estado.checkout.rua = d.logradouro || estado.checkout.rua;
    estado.checkout.bairro = d.bairro || estado.checkout.bairro;
    estado.checkout.cidade = d.localidade || estado.checkout.cidade;
    estado.checkout.uf = d.uf || estado.checkout.uf;
    renderizarCarrinho();
    const i2 = document.getElementById('ck-zona-info');
    if(i2){
      if((estado.loja.zonas||[]).length > 0){
        i2.textContent = 'Buscando sua localização na área de entrega...';
      } else {
        i2.textContent = 'Endereço preenchido.';
      }
    }
    if((estado.loja.zonas||[]).length > 0){
      localizarZona();
    }
  }catch(e){
    if(info){info.textContent='Falha ao buscar CEP';info.className='zona-info err';}
  }
}

async function localizarZona(){
  const info = document.getElementById('ck-zona-info');
  const q = [estado.checkout.rua, estado.checkout.bairro, estado.checkout.cidade, estado.checkout.uf].filter(Boolean).join(', ');
  if(!q){ if(info){info.textContent='Preencha o endereço primeiro';info.className='zona-info err';} return; }
  if(info){info.textContent='Localizando sua região...';info.className='zona-info';}
  try{
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q='+encodeURIComponent(q), { headers: { 'Accept': 'application/json' } });
    const d = await r.json();
    if(!d || !d.length){ if(info){info.textContent='Não foi possível localizar a região. Selecione a zona manualmente.';info.className='zona-info err';} return; }
    const lat = parseFloat(d[0].lat), lng = parseFloat(d[0].lon);
    const z = encontrarZona(lat, lng);
    if(z){
      estado.checkout.zonaId = z.id;
      renderizarCarrinho();
      const i2 = document.getElementById('ck-zona-info');
      if(i2){i2.textContent='Zona encontrada: '+esc(z.nome)+' — entrega '+fmt(z.preco);i2.className='zona-info ok';}
      atualizarResumo();
    } else {
      estado.checkout.zonaId = null;
      renderizarCarrinho();
      const i2 = document.getElementById('ck-zona-info');
      if(i2){i2.textContent='Seu endereço está fora da área de entrega.';i2.className='zona-info err';}
      atualizarResumo();
    }
  }catch(e){
    if(info){info.textContent='Falha ao localizar. Selecione a zona manualmente.';info.className='zona-info err';}
  }
}

function atualizarResumo(){
  const tx = taxaAtual();
  const entregaLinha = document.getElementById('r-entrega-linha');
  const entregaLbl = document.getElementById('r-entrega-lbl');
  const entregaVal = document.getElementById('r-entrega');
  const totalEl = document.getElementById('r-total');
  const subEl = document.getElementById('r-subtotal');
  const st = total();
  subEl.textContent = fmt(st);
  if(tx !== null){
    const mostra = estado.checkout.modo === 'entrega';
    entregaLinha.style.display = mostra ? 'flex' : 'none';
    if(mostra){
      const z = zonaSelecionada();
      entregaLbl.textContent = z ? ('Entrega — '+esc(z.nome)) : 'Entrega';
      entregaVal.textContent = fmt(tx);
      totalEl.textContent = fmt(st + tx);
    } else {
      totalEl.textContent = fmt(st);
    }
  } else {
    entregaLinha.style.display = 'flex';
    entregaLbl.textContent = 'Entrega';
    entregaVal.textContent = 'Selecione a zona';
    totalEl.textContent = fmt(st);
  }
}

function finalizarPedido(){
  const ids = Object.keys(estado.carrinho);
  if(!ids.length) return;
  if(estado.loja.pedidos_ativos === false){ toast('Pedidos temporariamente desativados.'); return; }
  const nome = estado.checkout.nome.trim();
  if(!nome){ toast('Informe seu nome para o pedido'); abrirCarrinho(); return; }
  const tx = taxaAtual();
  if(estado.checkout.modo === 'entrega' && tx === null){
    toast('Selecione a zona de entrega ou mude para retirada'); abrirCarrinho(); return;
  }
  const modo = estado.checkout.modo === 'retirada' ? 'Retirada na loja' : 'Entrega';
  const z = zonaSelecionada();
  let txt = '*Novo pedido — '+estado.loja.nome+'*\\n\\n';
  txt += '*Cliente:* '+nome+'\\n';
  if(estado.checkout.whatsapp.trim()) txt += '*WhatsApp:* '+estado.checkout.whatsapp.trim()+'\\n';
  txt += '*Forma:* '+modo+'\\n';
  if(modo === 'Entrega'){
    const end = [estado.checkout.rua, estado.checkout.numero ? 'nº '+estado.checkout.numero : '', estado.checkout.bairro, estado.checkout.cidade, estado.checkout.uf].filter(Boolean).join(', ');
    if(estado.checkout.cep) txt += '*CEP:* '+estado.checkout.cep+'\\n';
    txt += '*Endereço:* '+end+'\\n';
    if(z) txt += '*Zona:* '+z.nome+'\\n';
    if(tx > 0) txt += '*Taxa de entrega:* '+fmt(tx)+'\\n';
  }
  txt += '\\n*Itens do pedido:*\\n';
  for(const id of ids){
    const p = estado.produtos.find(x=>x.id===Number(id));
    if(!p) continue;
    const preco = p.tem_promo&&p.preco_promo>0?p.preco_promo:p.preco;
    txt += '• '+p.nome+' — '+estado.carrinho[id]+'x = '+fmt(preco*estado.carrinho[id])+'\\n';
  }
  const st = total();
  txt += '\\n*Subtotal: '+fmt(st)+'*';
  if(estado.checkout.modo === 'entrega' && tx > 0) txt += '\\n*Entrega: '+fmt(tx)+'*';
  txt += '\\n*Total: '+fmt(st + (estado.checkout.modo === 'entrega' ? (tx||0) : 0))+'*';
  if(estado.checkout.obs.trim()) txt += '\\n*Obs:* '+estado.checkout.obs.trim();
  const tel = (estado.loja.telefone||'').replace(/\D/g,'');
  if(tel){
    window.open('https://wa.me/55'+tel+'?text='+encodeURIComponent(txt), '_blank');
  } else {
    toast('Pedido montado! Apresente à loja.');
  }
}

function abrirCarrinho(){ renderizarCarrinho(); document.getElementById('drawer').classList.add('aberto'); document.getElementById('overlay').classList.add('aberto'); }
function fecharCarrinho(){ document.getElementById('drawer').classList.remove('aberto'); document.getElementById('overlay').classList.remove('aberto'); }
function fecharDrawers(){ fecharCarrinho(); fecharInfo(); fecharPolitica(); }

function abrirInfo(){
  document.getElementById('info-nome').textContent = estado.loja.nome;
  document.getElementById('info-endereco').textContent = estado.loja.endereco || '—';
  document.getElementById('info-horario').textContent = estado.loja.horario || '—';
  document.getElementById('info-telefone').textContent = estado.loja.telefone || '—';
  document.getElementById('modal-info').classList.add('aberto');
}
function fecharInfo(){ document.getElementById('modal-info').classList.remove('aberto'); }
function mostrarPolitica(){ document.getElementById('modal-politica').classList.add('aberto'); }
function fecharPolitica(){ document.getElementById('modal-politica').classList.remove('aberto'); }

let toastTimer;
function toast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('visivel'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('visivel'),1800); }

function voltarTopo(){ window.scrollTo({top:0,behavior:'smooth'}); }
function limparBusca(){ document.getElementById('busca').value=''; estado.busca=''; renderizar(); }

// debounce busca
let buscaTimer;
document.getElementById('busca').addEventListener('input', (e)=>{
  clearTimeout(buscaTimer);
  buscaTimer = setTimeout(()=>{ estado.busca = e.target.value; renderizar(); }, 200);
});
document.getElementById('ordenar').addEventListener('change', (e)=>{ estado.ordem = e.target.value; renderizar(); });

// voltar topo visível
window.addEventListener('scroll', ()=>{
  document.getElementById('voltar-topo').classList.toggle('visivel', window.scrollY > 600);
});

// footer infos
document.getElementById('logo').textContent = (estado.loja.nome||'S').charAt(0).toUpperCase();
document.getElementById('foot-endereco').textContent = estado.loja.endereco || 'Localização: consulte a loja';
document.getElementById('foot-horario').textContent = estado.loja.horario ? 'Horário: '+estado.loja.horario : '';
document.getElementById('foot-telefone').textContent = estado.loja.telefone ? 'Tel: '+estado.loja.telefone : '';

carregarCarrinho();
renderizarSidebar();
renderizar();

// Manutenção / pedidos desativados
const manutencaoAtiva = !!(estado.loja.manutencao_ativos);
const pedidosAtivos = estado.loja.pedidos_ativos !== false;
if(pedidosAtivos === false){
  document.getElementById('aviso-pedidos').classList.add('visivel');
  document.getElementById('cart-btn').style.display = 'none';
}
if(manutencaoAtiva){
  document.getElementById('manut-logo').textContent = (estado.loja.nome||'S').charAt(0).toUpperCase();
  document.getElementById('manut-texto').textContent = 'Estamos atualizando o catálogo. Volte em instantes' + (estado.loja.telefone ? ' ou fale conosco pelo WhatsApp.' : '.');
  if(estado.loja.telefone){
    document.getElementById('manut-contato').innerHTML = '📱 <a href="https://wa.me/55'+(estado.loja.telefone||'').replace(/\\D/g,'')+'" style="color:var(--brand-d);font-weight:700">WhatsApp: '+(estado.loja.telefone||'')+'</a>';
  }
  document.getElementById('manutencao-overlay').classList.add('visivel');
}
</script>
</body>
</html>`

  // Camada pública específica para atendimento WhatsApp (somente produtos públicos)
  const catalogJson = JSON.stringify(
    {
      loja: cfg.nome_loja,
      atualizado_em: agora,
      categorias,
      quantidade: produtos.length,
      produtos: produtos.map((p) => ({ id: p.id, nome: p.nome, codigo: p.codigo }))
    },
    null,
    2
  )
  const productsJson = JSON.stringify(produtos, null, 2)

  const arquivos: Record<string, string | Buffer> = { 'index.html': html, 'dados.json': json, 'dados.js': dadosJs }

  arquivos['api/whatsapp/catalog.json'] = catalogJson
  arquivos['api/whatsapp/products.json'] = productsJson
  for (const p of produtos) {
    arquivos[`api/whatsapp/products/${p.id}.json`] = JSON.stringify(p, null, 2)
  }

  // Imagens: redimensiona/comprime os BLOBs do SQLite e publica em imagens/<id>.jpg.
  // Cache em disco evita reprocessar imagens inalteradas (sharp é lento em lote).
  let processadas = 0
  let reutilizadas = 0
  const hashesCache = lerCacheImagensHashes()
  for (const p of produtos) {
    if (!p.imagem) continue
    const id = String(p.id)
    const row = getDb().prepare(`SELECT imagem FROM produtos WHERE id = ?`).get(Number(id)) as { imagem: Uint8Array | null } | undefined
    if (!row?.imagem || row.imagem.length === 0) continue
    const hashOrig = createHash('sha1').update(Buffer.from(row.imagem)).digest('hex')
    const processada = await processarImagemProduto(Number(id), hashOrig)
    if (!processada) continue
    arquivos[`imagens/${id}.jpg`] = processada
    if (hashesCache[id] === hashOrig) reutilizadas++
    else processadas++
  }
  console.log(`[catalogo] Imagens: ${processadas} processada(s), ${reutilizadas} reutilizada(s) do cache.`)

  return arquivos
}

// SHA-1 do blob Git (formato "blob <tamanho>\\0<conteudo>") — deterministico,
// permite reutilizar blobs ja publicados sem chamar a API.
export function shaGitBlob(conteudo: string | Buffer): string {
  const buf = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo, 'utf8')
  return createHash('sha1').update(`blob ${buf.length}\u0000`).update(buf).digest('hex')
}

function lerCacheBlobs(): Record<string, string> {
  try {
    const db = getDb()
    const r = db.prepare(`SELECT valor FROM catalogo_sync WHERE chave = 'blobs'`).get() as { valor: string } | undefined
    return r?.valor ? (JSON.parse(r.valor) as Record<string, string>) : {}
  } catch { return {} }
}

function salvarCacheBlobs(cache: Record<string, string>): void {
  try {
    const db = getDb()
    db.prepare(`INSERT INTO catalogo_sync (chave, valor) VALUES ('blobs', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`).run(JSON.stringify(cache))
  } catch { /* ignore */ }
}

// Cache de imagens em disco: guarda o JPEG já processado por produto
// (imagens_cache/<id>.jpg) e o hash do blob original (imagens_cache/hashes.json).
// Se o blob original não mudou, reaproveita o arquivo — evita reprocessar
// (sharp é lento em lote) e mantém a árvore sempre com todas as imagens.
const IMAGEM_LADO_MAX = 800
const IMAGEM_QUALIDADE = 80

function cacheImagensDir(): string {
  const base = process.env.TABACARIA_DB
    ? join(process.env.TABACARIA_DB, '..', 'imagens_cache')
    : join(process.env.APPDATA || process.env.USERPROFILE || '.', 'sistema-loja-tabacaria', 'imagens_cache')
  if (!existsSync(base)) mkdirSync(base, { recursive: true })
  return base
}

function lerCacheImagensHashes(): Record<string, string> {
  try {
    const f = join(cacheImagensDir(), 'hashes.json')
    if (!existsSync(f)) return {}
    return JSON.parse(readFileSync(f, 'utf8')) as Record<string, string>
  } catch { return {} }
}

function salvarCacheImagensHashes(cache: Record<string, string>): void {
  try {
    writeFileSync(join(cacheImagensDir(), 'hashes.json'), JSON.stringify(cache))
  } catch { /* ignore */ }
}

async function processarImagemProduto(id: number, hashOrig: string): Promise<Buffer | null> {
  const dir = cacheImagensDir()
  const arquivo = join(dir, `${id}.jpg`)
  const hashes = lerCacheImagensHashes()
  if (hashes[String(id)] === hashOrig && existsSync(arquivo)) {
    try { return readFileSync(arquivo) } catch { /* reprocessa */ }
  }
  const row = getDb().prepare(`SELECT imagem FROM produtos WHERE id = ?`).get(id) as { imagem: Uint8Array | null } | undefined
  if (!row?.imagem || row.imagem.length === 0) return null
  try {
    const processada = await sharp(Buffer.from(row.imagem), { failOn: 'none' })
      .resize({ width: IMAGEM_LADO_MAX, height: IMAGEM_LADO_MAX, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: IMAGEM_QUALIDADE, mozjpeg: true })
      .toBuffer()
    writeFileSync(arquivo, processada)
    const novoHashes = { ...hashes, [String(id)]: hashOrig }
    salvarCacheImagensHashes(novoHashes)
    return processada
  } catch (err) {
    console.log(`[catalogo] Imagem do produto ${id} ignorada (falha ao processar): ${(err as Error).message}`)
    return null
  }
}

export async function publicarGitHub(produtos: ProdutoPublico[], cfg: CatalogoConfig): Promise<{ ok: boolean; erro?: string }> {
  if (!cfg.github_token || !cfg.github_repo) {
    return { ok: false, erro: 'Configure o token e o repositório do GitHub nas Configurações do Catálogo.' }
  }
  const arquivos = await gerarSiteEstatico(produtos, cfg)
  const repo = cfg.github_repo.replace(/^https?:\/\/(www\.)?github\.com\//, '').replace(/\.git$/, '')
  const branch = cfg.github_branch || 'gh-pages'
  const headers = {
    Authorization: `token ${cfg.github_token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'sistema-loja-tabacaria'
  }

  const apiGitHub = async (caminho: string, opts: RequestInit = {}): Promise<Response> => {
    return fetch(`https://api.github.com${caminho}`, { ...opts, headers: { ...headers, ...(opts.headers ?? {}) } })
  }

  // Garantir branch gh-pages
  try {
    const r = await apiGitHub(`/repos/${repo}/git/ref/heads/${branch}`)
    if (!r.ok) {
      const def = await apiGitHub(`/repos/${repo}`)
      const info = await def.json() as { default_branch?: string }
      const sha = await apiGitHub(`/repos/${repo}/git/ref/heads/${info.default_branch}`).then((x) => x.json()) as { object?: { sha: string } }
      await apiGitHub(`/repos/${repo}/git/refs`, {
        method: 'POST',
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: sha.object?.sha })
      })
    }
  } catch { /* ignore */ }

  const entradas = Object.entries(arquivos)
  console.log(`[catalogo] Publicação iniciada (Git Trees) — ${entradas.length} arquivo(s) para ${repo}/${branch}`)

  const maxTentativas = 3
  const MAX_ARVORE = 800

  const api = apiGitHub

  const publicarArvore = async (): Promise<{ ok: boolean; erro?: string; conflito?: boolean }> => {
    // 1. SHA atual da branch
    const refRes = await api(`/repos/${repo}/git/ref/heads/${branch}`)
    if (!refRes.ok) {
      const t = (await refRes.text()).slice(0, 200)
      return { ok: false, erro: `Falha ao ler ref da branch: HTTP ${refRes.status} ${t}` }
    }
    const refData = await refRes.json() as { object?: { sha?: string } }
    const commitAtual = refData.object?.sha
    if (!commitAtual) return { ok: false, erro: 'Não foi possível obter o SHA do commit atual da branch.' }

    let baseTree: string | undefined
    try {
      const commitRes = await api(`/repos/${repo}/git/commits/${commitAtual}`)
      if (commitRes.ok) {
        const commitData = await commitRes.json() as { tree?: { sha?: string } }
        baseTree = commitData.tree?.sha
      }
    } catch { baseTree = undefined }

    // 3. Reutilizar blobs já publicados: calcula o sha local e compara com a
    //    árvore atual do repo. Só cria via API os arquivos que mudaram.
    const blobs: Record<string, string> = {}
    const cacheBlobs = lerCacheBlobs()
    const shaPorCaminhoRepo: Record<string, string> = {}

    // Busca a árvore atual (recursive) uma única vez para mapear caminho -> sha
    try {
      if (baseTree) {
        const treeResp = await api(`/repos/${repo}/git/trees/${baseTree}?recursive=1`)
        if (treeResp.ok) {
          const treeData = await treeResp.json() as { tree?: { path?: string; sha?: string; type?: string }[] }
          for (const item of treeData.tree ?? []) {
            if (item.type === 'blob' && item.path && item.sha) shaPorCaminhoRepo[item.path] = item.sha
          }
        }
      }
    } catch { /* árvore indisponível: segue criando tudo */ }

    const pendentes: [string, string | Buffer][] = []
    let reutilizados = 0
    for (const [caminho, conteudo] of entradas) {
      const shaLocal = shaGitBlob(conteudo)
      if (shaPorCaminhoRepo[caminho] === shaLocal) {
        blobs[caminho] = shaLocal
        cacheBlobs[caminho] = shaLocal
        reutilizados++
      } else if (cacheBlobs[caminho] === shaLocal) {
        blobs[caminho] = shaLocal
        reutilizados++
      } else {
        pendentes.push([caminho, conteudo])
      }
    }
    console.log(`[catalogo] Blobs reutilizados: ${reutilizados} | novos a criar: ${pendentes.length}`)

    const CONCORRENCIA = 3
    const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const criarBlob = async (caminho: string, conteudo: string | Buffer): Promise<string> => {
      for (let t = 1; t <= 5; t++) {
        const blobRes = await api(`/repos/${repo}/git/blobs`, {
          method: 'POST',
          body: JSON.stringify({ content: Buffer.isBuffer(conteudo) ? conteudo.toString('base64') : Buffer.from(conteudo, 'utf8').toString('base64'), encoding: 'base64' })
        })
        if (blobRes.ok) {
          const blobData = await blobRes.json() as { sha?: string }
          if (!blobData.sha) throw new Error(`Blob de ${caminho} sem SHA`)
          return blobData.sha
        }
        if (blobRes.status === 403 || blobRes.status === 429) {
          console.log(`[catalogo] Blob ${caminho} — rate limit, aguardando 15s (tentativa ${t}/5).`)
          await dormir(15000)
          continue
        }
        const corpo = (await blobRes.text()).slice(0, 200)
        throw new Error(`Falha ao criar blob de ${caminho}: HTTP ${blobRes.status} ${corpo}`)
      }
      throw new Error(`Falha ao criar blob de ${caminho}: rate limit persistente`)
    }
    const rodarLote = async (lote: [string, string | Buffer][]) => {
      const resultados = await Promise.all(lote.map(([c, conteudo]) => criarBlob(c, conteudo).then((sha) => ({ c, sha })).catch((err) => ({ c, err }))))
      for (const r of resultados) {
        if ('err' in r) throw r.err
        blobs[r.c] = r.sha
        cacheBlobs[r.c] = r.sha
      }
    }
    const filaBlobs: [string, string | Buffer][] = pendentes
    let indiceBlob = 0
    while (indiceBlob < filaBlobs.length) {
      const lote = filaBlobs.slice(indiceBlob, indiceBlob + CONCORRENCIA)
      await rodarLote(lote)
      indiceBlob += CONCORRENCIA
      if (indiceBlob < filaBlobs.length) await dormir(400)
    }

    // 4. Montar árvore. Separa produtos individuais, imagens e demais arquivos.
    const itensRaiz: { path: string; mode: string; type: string; sha: string }[] = []
    const produtosIndividuais: { id: string; sha: string }[] = []
    const imagensIndividuais: { id: string; sha: string }[] = []

    for (const [caminho, sha] of Object.entries(blobs)) {
      const m = caminho.match(/^api\/whatsapp\/products\/(\d+)\.json$/)
      if (m) {
        produtosIndividuais.push({ id: m[1], sha })
        continue
      }
      const mi = caminho.match(/^imagens\/(\d+)\.jpg$/)
      if (mi) {
        imagensIndividuais.push({ id: mi[1], sha })
        continue
      }
      itensRaiz.push({ path: caminho, mode: '100644', type: 'blob', sha })
    }

    // 5. Monta árvore de uma pasta com muitos blobs (products/, imagens/).
    // Se couber numa única árvore, usa direto. Caso contrário, tenta e se 422/502
    // por tamanho, particiona em sub-árvores de chunk com base_tree incremental.
    const criarTree = async (itens: { path: string; mode: string; type: string; sha: string }[], base?: string): Promise<string> => {
      const body: Record<string, unknown> = { tree: itens }
      if (base) body.base_tree = base
      const res = await api(`/repos/${repo}/git/trees`, { method: 'POST', body: JSON.stringify(body) })
      if (!res.ok) {
        const t = (await res.text()).slice(0, 200)
        throw new Error(`Falha ao criar árvore: HTTP ${res.status} ${t}`)
      }
      const d = await res.json() as { sha?: string }
      if (!d.sha) throw new Error('Árvore criada sem SHA')
      return d.sha
    }

    const criarArvorePasta = async (itens: { id: string; sha: string }[], ext: string): Promise<string | null> => {
      if (itens.length === 0) return null
      const montar = () => itens.map((p) => ({ path: `${p.id}.${ext}`, mode: '100644', type: 'blob', sha: p.sha }))
      if (itens.length <= MAX_ARVORE) {
        return criarTree(montar())
      }
      try {
        return await criarTree(montar())
      } catch {
        let arvore = await criarTree(itens.slice(0, MAX_ARVORE).map((p) => ({ path: `${p.id}.${ext}`, mode: '100644', type: 'blob', sha: p.sha })))
        for (let i = MAX_ARVORE; i < itens.length; i += MAX_ARVORE) {
          const pedaco = itens.slice(i, i + MAX_ARVORE).map((p) => ({ path: `${p.id}.${ext}`, mode: '100644', type: 'blob', sha: p.sha }))
          arvore = await criarTree(pedaco, arvore)
        }
        return arvore
      }
    }

    const produtosTreeSha = await criarArvorePasta(produtosIndividuais, 'json')
    const imagensTreeSha = await criarArvorePasta(imagensIndividuais, 'jpg')

    // Árvore da pasta whatsapp (catalog.json, products.json, products/)
    const itensWhatsapp: { path: string; mode: string; type: string; sha: string }[] = []
    for (const i of itensRaiz) {
      if (i.path.startsWith('api/whatsapp/')) itensWhatsapp.push({ ...i, path: i.path.replace(/^api\/whatsapp\//, '') })
    }
    if (produtosTreeSha) itensWhatsapp.push({ path: 'products', mode: '040000', type: 'tree', sha: produtosTreeSha })
    const whatsappSha = await criarTree(itensWhatsapp)

    // Árvore api/ contendo whatsapp/
    const apiSha = await criarTree([{ path: 'whatsapp', mode: '040000', type: 'tree', sha: whatsappSha }])

    // Árvore raiz: index.html, dados.json + imagens/ + api/
    const itensRoot: { path: string; mode: string; type: string; sha: string }[] = itensRaiz.filter((i) => !i.path.startsWith('api/whatsapp/'))
    if (imagensTreeSha) itensRoot.push({ path: 'imagens', mode: '040000', type: 'tree', sha: imagensTreeSha })
    itensRoot.push({ path: 'api', mode: '040000', type: 'tree', sha: apiSha })

    const treeBody: Record<string, unknown> = { tree: itensRoot }
    if (baseTree) treeBody.base_tree = baseTree
    const treeRes = await api(`/repos/${repo}/git/trees`, { method: 'POST', body: JSON.stringify(treeBody) })
    if (!treeRes.ok) {
      const t = (await treeRes.text()).slice(0, 200)
      return { ok: false, erro: `Falha ao criar árvore raiz: HTTP ${treeRes.status} ${t}` }
    }
    const treeData = await treeRes.json() as { sha?: string }
    if (!treeData.sha) return { ok: false, erro: 'Árvore raiz sem SHA' }

    // 6. Commit
    const commitBody: Record<string, unknown> = { message: `[catálogo] atualização ${new Date().toISOString()} (${entradas.length} arquivos)`, tree: treeData.sha }
    if (commitAtual) commitBody.parents = [commitAtual]
    const commitRes = await api(`/repos/${repo}/git/commits`, { method: 'POST', body: JSON.stringify(commitBody) })
    if (!commitRes.ok) {
      const t = (await commitRes.text()).slice(0, 200)
      return { ok: false, erro: `Falha ao criar commit: HTTP ${commitRes.status} ${t}` }
    }
    const commitData = await commitRes.json() as { sha?: string }
    if (!commitData.sha) return { ok: false, erro: 'Commit criado sem SHA' }

    // 7. Atualizar ref
    const updateRes = await api(`/repos/${repo}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commitData.sha, force: false })
    })
    if (!updateRes.ok) {
      const t = (await updateRes.text()).slice(0, 200)
      if (updateRes.status === 409) return { ok: false, erro: `Conflito ao atualizar ref (409). ${t}`, conflito: true }
      return { ok: false, erro: `Falha ao atualizar ref: HTTP ${updateRes.status} ${t}` }
    }

    salvarCacheBlobs(cacheBlobs)

    return { ok: true }
  }

  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    console.log(`[catalogo] Publicação — tentativa ${tentativa}/${maxTentativas}`)
    const r = await publicarArvore()
    if (r.ok) {
      console.log(`[catalogo] Publicação concluída em 1 commit — ${entradas.length} arquivo(s)`)
      return { ok: true }
    }
    if (r.conflito && tentativa < maxTentativas) {
      console.log(`[catalogo] Conflito de ref (409), relendo SHA e tentando novamente.`)
      continue
    }
    return { ok: false, erro: r.erro }
  }
  return { ok: false, erro: 'Falha ao publicar' }
}

export interface StatusCatalogo {
  status: string
  ultima_sync: string
  proxima_sync: string
  produtos_publicados: number
  pendentes: number
  ultimo_erro: string
  site_url: string
  configurado: boolean
  sincronizando: boolean
}

let sincronizando = false

export function getStatus(): StatusCatalogo {
  const db = getDb()
  const cfg = getConfig()
  const publicados = db.prepare(`SELECT COUNT(*) AS c FROM produtos WHERE ativo = 1 AND catalogo_publicado = 1`).get() as { c: number }
  const pendentes = db.prepare(`SELECT COUNT(*) AS c FROM catalogo_fila`).get() as { c: number }
  const ultima = getSync('ultima_sync')
  let proxima = '—'
  if (ultima) {
    const d = new Date(ultima)
    d.setHours(d.getHours() + 1)
    proxima = d.toLocaleString('pt-BR')
  }
  return {
    status: getSync('status') || 'nunca_sincronizado',
    ultima_sync: ultima ? new Date(ultima).toLocaleString('pt-BR') : 'Nunca',
    proxima_sync: proxima,
    produtos_publicados: publicados.c,
    pendentes: pendentes.c,
    ultimo_erro: getSync('ultimo_erro'),
    site_url: cfg.site_url || (cfg.github_repo ? `https://${cfg.github_repo.split('/')[0]}.github.io/${cfg.github_repo.split('/')[1] ?? ''}` : ''),
    configurado: !!(cfg.github_token && cfg.github_repo),
    sincronizando
  }
}

export async function sincronizarAgora(): Promise<{ ok: boolean; erro?: string }> {
  if (sincronizando) {
    console.log('[catalogo] Sincronização já em andamento (memória) — chamada ignorada.')
    return { ok: false, erro: 'Sincronização já em andamento.' }
  }
  if (!adquirirLock()) {
    console.log('[catalogo] Sincronização já em andamento (lock do banco) — chamada ignorada.')
    return { ok: false, erro: 'Sincronização já em andamento.' }
  }
  sincronizando = true
  try {
    console.log('[catalogo] Sincronização iniciada.')
    setSync('status', 'sincronizando')
    setSync('ultimo_erro', '')
    const online = await temInternet()
    if (!online) {
      setSync('status', 'sem_conexao')
      setSync('ultimo_erro', 'Sem conexão com a internet. As alterações ficarão pendentes.')
      console.log('[catalogo] Sem internet — alterações mantidas pendentes.')
      return { ok: false, erro: 'Sem conexão com a internet.' }
    }
    const cfg = getConfig()
    if (!cfg.github_token || !cfg.github_repo) {
      setSync('status', 'nao_configurado')
      setSync('ultimo_erro', 'Configure token e repositório do GitHub.')
      console.log('[catalogo] Não configurado (token/repositório).')
      return { ok: false, erro: 'Catálogo não configurado.' }
    }
    try {
      const produtos = gerarDadosPublicos()
      const res = await publicarGitHub(produtos, cfg)
      if (!res.ok) {
        setSync('status', 'erro')
        setSync('ultimo_erro', res.erro ?? 'Erro ao publicar')
        console.log(`[catalogo] Sincronização falhou: ${res.erro ?? 'erro desconhecido'}`)
        return res
      }
      const agora = new Date().toISOString()
      setSync('status', 'sincronizado')
      setSync('ultima_sync', agora)
      setSync('ultimo_erro', '')
      const db = getDb()
      db.prepare(`DELETE FROM catalogo_fila`).run()
      db.prepare(`UPDATE produtos SET alterado_em = NULL WHERE alterado_em IS NOT NULL`).run()
      console.log('[catalogo] Sincronização concluída com sucesso.')
      return { ok: true }
    } catch (err) {
      setSync('status', 'erro')
      setSync('ultimo_erro', (err as Error).message)
      console.log(`[catalogo] Sincronização falhou: ${(err as Error).message}`)
      return { ok: false, erro: (err as Error).message }
    }
  } finally {
    liberarLock()
    sincronizando = false
  }
}

export async function testarConexao(): Promise<{ ok: boolean; mensagem: string }> {
  const online = await temInternet()
  if (!online) return { ok: false, mensagem: 'Sem conexão com a internet.' }
  const cfg = getConfig()
  if (!cfg.github_token || !cfg.github_repo) return { ok: false, mensagem: 'Catálogo não configurado (token/repositório).' }
  try {
    const headers = { Authorization: `token ${cfg.github_token}`, 'User-Agent': 'sistema-loja-tabacaria' }
    const res = await fetch(`https://api.github.com/repos/${cfg.github_repo}`, { headers })
    if (res.ok) return { ok: true, mensagem: 'Conexão com o GitHub OK. Repositório acessível.' }
    return { ok: false, mensagem: `GitHub respondeu HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, mensagem: `Erro: ${(err as Error).message}` }
  }
}

// Backup da configuração do catálogo (token/repositório/branch/nome) em arquivo local.
// Permite restaurar os dados salvos sem depender do banco principal.

function dirBackupConfig(): string {
  const base = process.env.TABACARIA_DB
    ? join(process.env.TABACARIA_DB, '..')
    : join(process.env.APPDATA || process.env.USERPROFILE || '.', 'sistema-loja-tabacaria')
  if (!existsSync(base)) mkdirSync(base, { recursive: true })
  return base
}

export function backupConfigCatalogo(): { ok: boolean; arquivo: string; data: string } {
  const cfg = getConfig()
  const conteudo = {
    criado_em: new Date().toISOString(),
    config: {
      github_token: cfg.github_token,
      github_repo: cfg.github_repo,
      github_branch: cfg.github_branch,
      site_url: cfg.site_url,
      nome_loja: cfg.nome_loja
    }
  }
  const arquivo = join(dirBackupConfig(), 'catalogo_config_backup.json')
  try {
    writeFileSync(arquivo, JSON.stringify(conteudo, null, 2), 'utf8')
    return { ok: true, arquivo, data: conteudo.criado_em }
  } catch (e) {
    return { ok: false, arquivo, data: '' }
  }
}

export function getBackupConfigCatalogo(): { existe: boolean; data: string; config: Partial<CatalogoConfig> } {
  const arquivo = join(dirBackupConfig(), 'catalogo_config_backup.json')
  if (!existsSync(arquivo)) return { existe: false, data: '', config: {} }
  try {
    const d = JSON.parse(readFileSync(arquivo, 'utf8')) as { criado_em?: string; config?: Partial<CatalogoConfig> }
    return { existe: true, data: d.criado_em || '', config: d.config || {} }
  } catch {
    return { existe: false, data: '', config: {} }
  }
}

export function restaurarBackupConfigCatalogo(): { ok: boolean; config?: CatalogoConfig; erro?: string } {
  const bkp = getBackupConfigCatalogo()
  if (!bkp.existe || !bkp.config.github_token || !bkp.config.github_repo) {
    return { ok: false, erro: 'Nenhum backup de configuração do catálogo encontrado.' }
  }
  try {
    const novo = salvarConfig({
      github_token: bkp.config.github_token,
      github_repo: bkp.config.github_repo,
      github_branch: bkp.config.github_branch,
      site_url: bkp.config.site_url,
      nome_loja: bkp.config.nome_loja
    })
    return { ok: true, config: novo }
  } catch (e) {
    return { ok: false, erro: (e as Error).message }
  }
}

import { useState } from 'react'
import { getDbApi, getImportarApi } from '../../shared/db'

interface DadosImportacao {
  arquivo: string
  colunas: string[]
  linhas: Record<string, unknown>[]
  erro?: string
}

const CAMPOS: { campo: string; label: string; chaves: string[] }[] = [
  { campo: 'nome', label: 'Nome', chaves: ['nome', 'produto'] },
  { campo: 'observacoes', label: 'Observação', chaves: ['observação', 'observacao', 'obs', 'descricao', 'descrição', 'description'] },
  { campo: 'codigo_barras', label: 'Código / EAN / GTIN', chaves: ['ean', 'gtin', 'código', 'codigo', 'ean/gtin', 'código de barras', 'codigo de barras'] },
  { campo: 'codigo_extra', label: 'Código Extra', chaves: ['código extra', 'codigo extra'] },
  { campo: 'preco_venda', label: 'Preço', chaves: ['preço', 'preco', 'preço de venda', 'preco de venda', 'valor'] },
  { campo: 'estoque', label: 'Estoque atual', chaves: ['estoque atual', 'estoque', 'saldo'] },
  { campo: 'estoque_minimo', label: 'Estoque mín.', chaves: ['estoque min', 'estoque mín', 'estoque mínimo', 'estoque minimo'] },
  { campo: 'estoque_maximo', label: 'Estoque máx.', chaves: ['estoque max', 'estoque máx', 'estoque máximo', 'estoque maximo'] },
  { campo: 'categoria', label: 'Categoria', chaves: ['categoria', 'departamento'] },
  { campo: 'subcategoria', label: 'Sub Categoria', chaves: ['sub categoria', 'subcategoria', 'sub-categoria'] },
  { campo: 'marca', label: 'Marca', chaves: ['marca'] },
  { campo: 'fornecedor', label: 'Fornecedor', chaves: ['fornecedor principal', 'fornecedor'] },
  { campo: 'unidade', label: 'Unidade', chaves: ['unidade', 'unid', 'und'] },
  { campo: 'peso_liq', label: 'Peso líquido', chaves: ['peso líq', 'peso liq', 'peso líquido', 'peso liquido'] },
  { campo: 'peso_bruto', label: 'Peso bruto', chaves: ['peso bruto'] },
  { campo: 'localizacao', label: 'Localização', chaves: ['localização', 'localizacao'] },
  { campo: 'preco_promo', label: 'Preço promocional', chaves: ['preço promocional', 'preco promocional'] },
  { campo: 'preco_atacado1', label: 'Preço atacado 1', chaves: ['preço atacado 1', 'preco atacado 1', 'preço atacado1', 'preco atacado1'] },
  { campo: 'qtd_min_atacado1', label: 'Qtd mín. atacado 1', chaves: ['qtd min atacado 1', 'qtd mín atacado 1', 'qtd min atacado1'] },
  { campo: 'preco_atacado2', label: 'Preço atacado 2', chaves: ['preço atacado 2', 'preco atacado 2', 'preço atacado2', 'preco atacado2'] },
  { campo: 'qtd_min_atacado2', label: 'Qtd mín. atacado 2', chaves: ['qtd min atacado 2', 'qtd mín atacado 2', 'qtd min atacado2'] },
  { campo: 'ncm', label: 'NCM', chaves: ['ncm'] },
  { campo: 'cest', label: 'CEST', chaves: ['cest'] }
]

function norm(v: unknown): string {
  return String(v ?? '').trim()
}

function paraNumero(v: unknown): number {
  if (typeof v === 'number') return isNaN(v) ? 0 : v
  if (v == null) return 0
  let s = String(v).replace('R$', '').replace(/[^\d,.-]/g, '').trim()
  if (!s) return 0
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (s.includes('.')) {
    const partes = s.split('.')
    if (partes.length > 2) {
      s = partes.slice(0, -1).join('') + '.' + partes[partes.length - 1]
    }
  }
  const n = Number(s)
  return isNaN(n) ? 0 : n
}

function buscarPorChaves(linha: Record<string, unknown>, colunas: string[], chaves: string[]): unknown {
  for (const c of colunas) {
    const nc = norm(c).toLowerCase()
    if (chaves.some((k) => nc === k || nc.includes(k))) {
      const v = linha[c]
      if (norm(v) !== '') return v
    }
  }
  return ''
}

export default function ImportarProdutos({ onConcluido }: { onConcluido?: () => void }) {
  const [dados, setDados] = useState<DadosImportacao | null>(null)
  const [mapeamento, setMapeamento] = useState<Record<string, string>>({})
  const [previewLinhas, setPreviewLinhas] = useState(10)
  const [mensagem, setMensagem] = useState('')
  const [importando, setImportando] = useState(false)

  const selecionarArquivo = async () => {
    const res = await getImportarApi().lerArquivo()
    if (!res) return
    setDados(res)
    if (res.erro) {
      setMensagem(res.erro)
      return
    }
    setMensagem('')
    const mapa: Record<string, string> = {}
    for (const campo of CAMPOS) {
      const col = res.colunas.find((c) => campo.chaves.some((k) => norm(c).toLowerCase() === k)) ?? ''
      mapa[campo.campo] = col
    }
    setMapeamento(mapa)
  }

  const valorLinha = (linha: Record<string, unknown>, campo: string): unknown => {
    const col = mapeamento[campo]
    return col ? linha[col] : ''
  }

  const linhaParaProduto = (linha: Record<string, unknown>) => {
    const nome = norm(valorLinha(linha, 'nome'))
    const codigo = norm(valorLinha(linha, 'codigo_barras'))
    const ean = norm(valorLinha(linha, 'ean_gtin')) || codigo
    return {
      nome,
      codigo_barras: codigo || null,
      codigo_extra: norm(valorLinha(linha, 'codigo_extra')) || null,
      preco_venda: paraNumero(valorLinha(linha, 'preco_venda')),
      estoque: paraNumero(valorLinha(linha, 'estoque')),
      estoque_minimo: paraNumero(valorLinha(linha, 'estoque_minimo')),
      estoque_maximo: paraNumero(valorLinha(linha, 'estoque_maximo')) || null,
      categoria: norm(valorLinha(linha, 'categoria')),
      subcategoria: norm(valorLinha(linha, 'subcategoria')),
      marca: norm(valorLinha(linha, 'marca')),
      fornecedor: norm(valorLinha(linha, 'fornecedor')),
      unidade: norm(valorLinha(linha, 'unidade')) || 'un',
      peso_liq: paraNumero(valorLinha(linha, 'peso_liq')) || null,
      peso_bruto: paraNumero(valorLinha(linha, 'peso_bruto')) || null,
      localizacao: norm(valorLinha(linha, 'localizacao')) || null,
      preco_promo: paraNumero(valorLinha(linha, 'preco_promo')) || null,
      preco_atacado1: paraNumero(valorLinha(linha, 'preco_atacado1')) || null,
      preco_atacado2: paraNumero(valorLinha(linha, 'preco_atacado2')) || null,
      qtd_min_atacado1: paraNumero(valorLinha(linha, 'qtd_min_atacado1')),
      qtd_min_atacado2: paraNumero(valorLinha(linha, 'qtd_min_atacado2')),
      ncm: norm(valorLinha(linha, 'ncm')) || null,
      cest: norm(valorLinha(linha, 'cest')) || null,
      observacoes: norm(valorLinha(linha, 'observacoes')) || null,
      exportar_balanca: norm(valorLinha(linha, 'exportar_balanca')) === 'Sim' ? 1 : 0
    }
  }

  const validos = () => {
    if (!dados) return []
    return dados.linhas.filter((l) => norm(valorLinha(l, 'nome')).trim() !== '')
  }

  const importar = async () => {
    const linhas = validos()
    if (linhas.length === 0) {
      setMensagem('Nenhuma linha com nome para importar.')
      return
    }
    if (!confirm(`Importar ${linhas.length} produto(s)? Categorias, marcas e fornecedores novos serão criados automaticamente.`)) return
    setImportando(true)
    const db = getDbApi()
    let criados = 0
    let atualizados = 0
    let semPreco = 0
    try {
      for (const linha of linhas) {
        const p = linhaParaProduto(linha)
        if (!p.nome) continue
        if (p.preco_venda <= 0) semPreco++

        let categoriaId: number | null = null
        if (p.categoria) {
          const cat = (await db.get(`SELECT id FROM categorias WHERE nome = ?`, [p.categoria])) as { id: number } | undefined
          categoriaId = cat?.id ?? Number((await db.run(`INSERT INTO categorias (nome) VALUES (?)`, [p.categoria])).lastInsertRowid)
          if (p.subcategoria) {
            const sub = (await db.get(
              `SELECT id FROM subcategorias WHERE nome = ? AND categoria_id = ?`,
              [p.subcategoria, categoriaId]
            )) as { id: number } | undefined
            if (!sub) {
              await db.run(`INSERT INTO subcategorias (categoria_id, nome) VALUES (?, ?)`, [categoriaId, p.subcategoria])
            }
          }
        }

        let marcaId: number | null = null
        if (p.marca) {
          const mar = (await db.get(`SELECT id FROM marcas WHERE nome = ?`, [p.marca])) as { id: number } | undefined
          marcaId = mar?.id ?? Number((await db.run(`INSERT INTO marcas (nome) VALUES (?)`, [p.marca])).lastInsertRowid)
        }

        let fornecedorId: number | null = null
        if (p.fornecedor) {
          const forn = (await db.get(`SELECT id FROM fornecedores WHERE nome = ?`, [p.fornecedor])) as { id: number } | undefined
          fornecedorId = forn?.id ?? Number((await db.run(`INSERT INTO fornecedores (nome) VALUES (?)`, [p.fornecedor])).lastInsertRowid)
        }

        const existente = p.codigo_barras
          ? ((await db.get(`SELECT id FROM produtos WHERE codigo_barras = ?`, [p.codigo_barras])) as { id: number } | undefined)
          : undefined

        if (existente) {
          await db.run(
            `UPDATE produtos SET nome=?, codigo_extra=?, preco_venda=?, estoque=?, estoque_minimo=?, estoque_maximo=?,
               categoria_id=?, marca_id=?, fornecedor_id=?, unidade=?, peso_liq=?, peso_bruto=?, localizacao=?,
               preco_promo=?, preco_atacado1=?, preco_atacado2=?, qtd_min_atacado1=?, qtd_min_atacado2=?,
               ncm=?, cest=?, observacoes=?, exportar_balanca=?
             WHERE id=?`,
            [p.nome, p.codigo_extra, p.preco_venda, p.estoque, p.estoque_minimo, p.estoque_maximo,
              categoriaId, marcaId, fornecedorId, p.unidade, p.peso_liq, p.peso_bruto, p.localizacao,
              p.preco_promo, p.preco_atacado1, p.preco_atacado2, p.qtd_min_atacado1, p.qtd_min_atacado2,
              p.ncm, p.cest, p.observacoes, p.exportar_balanca, existente.id]
          )
          atualizados++
        } else {
          await db.run(
            `INSERT INTO produtos (nome, codigo_barras, codigo_extra, preco_venda, estoque, estoque_minimo, estoque_maximo,
               categoria_id, marca_id, fornecedor_id, unidade, peso_liq, peso_bruto, localizacao,
               preco_promo, preco_atacado1, preco_atacado2, qtd_min_atacado1, qtd_min_atacado2,
               ncm, cest, observacoes, exportar_balanca)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [p.nome, p.codigo_barras, p.codigo_extra, p.preco_venda, p.estoque, p.estoque_minimo, p.estoque_maximo,
              categoriaId, marcaId, fornecedorId, p.unidade, p.peso_liq, p.peso_bruto, p.localizacao,
              p.preco_promo, p.preco_atacado1, p.preco_atacado2, p.qtd_min_atacado1, p.qtd_min_atacado2,
              p.ncm, p.cest, p.observacoes, p.exportar_balanca]
          )
          criados++
        }
      }
      setMensagem(
        `Importação concluída: ${criados} criado(s), ${atualizados} atualizado(s)${semPreco ? `, ${semPreco} sem preço` : ''}.`
      )
      setDados(null)
      onConcluido?.()
    } catch (err) {
      setMensagem(`Erro na importação: ${(err as Error).message}`)
    } finally {
      setImportando(false)
    }
  }

  if (!dados) {
    return (
      <div className="importar-vazio">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6h16v13H4z M4 11h16 M8 6V3h8v3 M12 15l-3-3 3-3 3 3z" />
        </svg>
        <p>Selecione uma planilha do Excel (.xlsx, .xls ou .csv) para importar produtos.</p>
        <p className="nota-config">
          Colunas reconhecidas: Nome, Código/EAN, Preço, Estoque, Código Extra, Categoria, Sub Categoria, Marca,
          Fornecedor, Unidade, Estoque Min/Max, Peso Líq/Bruto, Localização, Preço Promocional, NCM, CEST.
        </p>
        <button className="btn-primario" onClick={selecionarArquivo}>Selecionar planilha</button>
        {mensagem && <div className="mensagem">{mensagem}</div>}
      </div>
    )
  }

  return (
    <div className="importar-painel">
      <div className="page-header">
        <div>
          <h2>Importar produtos</h2>
          <p className="nota-config">Arquivo: {dados.arquivo} • {dados.linhas.length} linhas • {dados.colunas.length} colunas</p>
        </div>
        <div className="page-acoes">
          <button className="btn-secundario" onClick={selecionarArquivo}>Trocar arquivo</button>
          <button className="btn-primario" onClick={importar} disabled={importando || validos().length === 0}>
            {importando ? 'Importando...' : `Importar ${validos().length} produto(s)`}
          </button>
        </div>
      </div>

      {mensagem && <div className="mensagem">{mensagem}</div>}

      <section className="rel-painel">
        <h3>Mapeamento de colunas</h3>
        <div className="mapa-grid">
          {CAMPOS.map((c) => (
            <label key={c.campo}>
              {c.label}
              <select
                value={mapeamento[c.campo] ?? ''}
                onChange={(e) => setMapeamento({ ...mapeamento, [c.campo]: e.target.value })}
              >
                <option value="">— ignorar —</option>
                {dados.colunas.map((col) => (
                  <option key={col} value={col}>{col}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </section>

      <section className="rel-painel">
        <h3>Pré-visualização</h3>
        <div className="tabela-wrap">
          <table className="tabela">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Código</th>
                <th>Preço</th>
                <th>Estoque</th>
                <th>Categoria</th>
                <th>Marca</th>
              </tr>
            </thead>
            <tbody>
              {dados.linhas.slice(0, previewLinhas).map((l, i) => {
                const p = linhaParaProduto(l)
                return (
                  <tr key={i} className={!p.nome ? 'linha-cancelada' : ''}>
                    <td>{p.nome || '(sem nome)'}</td>
                    <td>{p.codigo_barras || '-'}</td>
                    <td>{p.preco_venda ? `R$ ${p.preco_venda.toFixed(2)}` : '-'}</td>
                    <td>{p.estoque}</td>
                    <td>{p.categoria || '-'}</td>
                    <td>{p.marca || '-'}</td>
                  </tr>
                )
              })}
              {dados.linhas.length === 0 && (
                <tr><td colSpan={6} className="sem-resultado">Planilha vazia.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {dados.linhas.length > previewLinhas && (
          <div className="modal-acoes">
            <button className="btn-mini" onClick={() => setPreviewLinhas((v) => v + 50)}>
              Mostrar mais ({dados.linhas.length - previewLinhas} restantes)
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

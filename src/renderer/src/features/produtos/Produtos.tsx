import { useEffect, useState, useCallback, useRef, ReactNode } from 'react'
import { getDbApi, getImagemApi } from '../../shared/db'
import CampoDinheiro, { parseMoeda, formatarMoeda } from '../../shared/CampoDinheiro'
import ImportarProdutos from './ImportarProdutos'
import Fornecedores from '../fornecedores/Fornecedores'

interface Produto {
  id: number
  nome: string
  codigo_barras: string | null
  codigo_interno: string | null
  codigo_extra: string | null
  categoria_id: number | null
  categoria_nome: string | null
  subcategoria_id: number | null
  marca_id: number | null
  marca_nome: string | null
  fornecedor_id: number | null
  preco_custo: number
  preco_venda: number
  preco_promo: number | null
  preco_atacado1: number | null
  preco_atacado2: number | null
  qtd_min_atacado1: number | null
  qtd_min_atacado2: number | null
  estoque: number
  estoque_minimo: number
  estoque_maximo: number | null
  unidade: string
  ativo: number
  imagem: string | null
  promocional: number
  controla_estoque: number
  permite_fracionado: number
  localizacao: string | null
  peso_liq: number | null
  peso_bruto: number | null
  observacoes: string | null
  preco_automatico: number
  preco_alteravel: number
  subcategoria_nome: string | null
  fornecedor_nome: string | null
  ncm: string | null
  cest: string | null
  exportar_balanca: number
  descricao: string | null
  publicado: number
  catalogo_publicado: number
  catalogo_ordem: number
  criado_em: string
}

interface Categoria {
  id: number
  nome: string
}

interface Subcategoria {
  id: number
  categoria_id: number
  nome: string
}

interface Marca {
  id: number
  nome: string
}

type AbaProduto = 'cadastro' | 'combo' | 'tributacao' | 'fornecedores' | 'opcoes' | 'validade' | 'transacoes'

const produtoVazio = {
  nome: '',
  codigo_barras: '',
  codigo_interno: '',
  codigo_extra: '',
  codigo_automatico: 1,
  categoria_id: '' as string,
  subcategoria_id: '' as string,
  marca_id: '' as string,
  fornecedor_id: '' as string,
  preco_custo: '',
  preco_venda: '',
  preco_promo: '',
  preco_atacado1: '',
  preco_atacado2: '',
  qtd_min_atacado1: '',
  qtd_min_atacado2: '',
  preco_automatico: 0,
  preco_alteravel: 1,
  promocional: 0,
  estoque: '',
  estoque_minimo: '',
  estoque_maximo: '',
  controla_estoque: 1,
  permite_fracionado: 0,
  unidade: 'un',
  localizacao: '',
  peso_liq: '',
  peso_bruto: '',
  observacoes: '',
  ativo: 1,
  catalogo_publicado: 1,
  catalogo_ordem: ''
}

const LIMITES_ESTOQUE = ['Padrão', 'Mínimo e máximo', 'Somente mínimo', 'Não controlar limites']

export default function Produtos({ produtoEdicaoId }: { produtoEdicaoId?: number | null }) {
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [subcategorias, setSubcategorias] = useState<Subcategoria[]>([])
  const [marcas, setMarcas] = useState<Marca[]>([])
  const [busca, setBusca] = useState('')
  const [form, setForm] = useState({ ...produtoVazio })
  const formOriginalRef = useRef({ ...produtoVazio })
  const [editandoId, setEditandoId] = useState<number | null>(null)
  const [formAberto, setFormAberto] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const [imagemPreview, setImagemPreview] = useState<string | null>(null)
  const [aba, setAba] = useState<AbaProduto>('cadastro')
  const [limiteEstoque, setLimiteEstoque] = useState('Padrão')
  const nomeRef = useRef<HTMLInputElement>(null)
  const obsAberto = useRef(false)
  const wrapProdRef = useRef<HTMLDivElement>(null)
  const scrollbarProdRef = useRef<HTMLDivElement>(null)
  const sincronizarScrollbarProd = () => {
    const wrap = wrapProdRef.current
    const sb = scrollbarProdRef.current
    if (!wrap || !sb) return
    const temScroll = wrap.scrollWidth > wrap.clientWidth
    sb.style.display = temScroll ? 'block' : 'none'
    if (temScroll) {
      const fill = sb.querySelector('.tabela-scrollbar-fixo-fill') as HTMLElement | null
      if (fill) fill.style.width = `${wrap.scrollWidth}px`
      sb.scrollLeft = wrap.scrollLeft
    }
  }
  const onScrollbarProd = () => {
    const wrap = wrapProdRef.current
    const sb = scrollbarProdRef.current
    if (wrap && sb) wrap.scrollLeft = sb.scrollLeft
  }
  const [modo, setModo] = useState<'lista' | 'importar' | 'fornecedores' | 'etiquetas' | 'tributacao'>('lista')
  const [limite, setLimite] = useState(50)
  const [paginaAtual, setPaginaAtual] = useState(1)
  const [buscaAvancada, setBuscaAvancada] = useState(false)
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'ativos' | 'inativos'>('ativos')
  const [filtroEspecial, setFiltroEspecial] = useState<'nenhum' | 'abaixo_min' | 'pedidos_abertos'>('nenhum')
  const [categoriaSel, setCategoriaSel] = useState<number | null>(null)
  const [subcategoriaSel, setSubcategoriaSel] = useState<number | null>(null)
  const [categoriasLateralAberta, setCategoriasLateralAberta] = useState(true)
  const [categoriasExpandidas, setCategoriasExpandidas] = useState<Record<number, boolean>>({})
  const [filtrosAbertos, setFiltrosAbertos] = useState(false)
  const [menuLayout, setMenuLayout] = useState(false)
  const [modalConfig, setModalConfig] = useState(false)
  const [digitosCodigo, setDigitosCodigo] = useState(() => Number(localStorage.getItem('produtos_digitos_codigo')) || 6)
  const [ordemColunas, setOrdemColunas] = useState<string[]>(() => {
    const padrao = ['acoes', 'imagem', 'nome', 'codigo', 'marca', 'venda', 'estoque', 'status']
    try {
      const salvo = localStorage.getItem('produtos_colunas')
      if (salvo) {
        const arr = JSON.parse(salvo)
        if (Array.isArray(arr) && arr.length <= 12 && arr.includes('acoes')) return arr
      }
    } catch {}
    return padrao
  })
  const [colunaArrastando, setColunaArrastando] = useState<string | null>(null)
  const [ordem, setOrdem] = useState<{ chave: string; dir: 'asc' | 'desc' } | null>(null)
  const [colunasAbertas, setColunasAbertas] = useState(false)
  const [largurasColunas, setLargurasColunas] = useState<Record<string, number>>(() => {
    try {
      const s = localStorage.getItem('produtos_larguras')
      return s ? JSON.parse(s) : {}
    } catch {
      return {}
    }
  })
  const redimProdRef = useRef<{ chave: string; startX: number; startW: number } | null>(null)
  const produtosExibidos = produtos.slice((paginaAtual - 1) * limite, paginaAtual * limite)
  const [imagensMap, setImagensMap] = useState<Record<number, string>>({})

  const TODAS_COLUNAS: { chave: string; label: string; tipo: 'texto' | 'numero' }[] = [
    { chave: 'acoes', label: 'Ações', tipo: 'texto' },
    { chave: 'imagem', label: 'Imagem', tipo: 'texto' },
    { chave: 'nome', label: 'Nome', tipo: 'texto' },
    { chave: 'codigo', label: 'Código', tipo: 'texto' },
    { chave: 'codigo_extra', label: 'Código extra', tipo: 'texto' },
    { chave: 'marca', label: 'Marca', tipo: 'texto' },
    { chave: 'categoria', label: 'Categoria', tipo: 'texto' },
    { chave: 'subcategoria', label: 'Subcategoria', tipo: 'texto' },
    { chave: 'fornecedor', label: 'Fornecedor', tipo: 'texto' },
    { chave: 'unidade', label: 'Unidade', tipo: 'texto' },
    { chave: 'custo', label: 'Custo', tipo: 'numero' },
    { chave: 'venda', label: 'Venda', tipo: 'numero' },
    { chave: 'promo', label: 'Promo', tipo: 'numero' },
    { chave: 'atacado1', label: 'Atacado 1', tipo: 'numero' },
    { chave: 'atacado2', label: 'Atacado 2', tipo: 'numero' },
    { chave: 'qtdmin1', label: 'Qtd mín 1', tipo: 'numero' },
    { chave: 'qtdmin2', label: 'Qtd mín 2', tipo: 'numero' },
    { chave: 'estoque', label: 'Estoque', tipo: 'numero' },
    { chave: 'estoque_min', label: 'Estoque mín', tipo: 'numero' },
    { chave: 'estoque_max', label: 'Estoque máx', tipo: 'numero' },
    { chave: 'peso_liq', label: 'Peso líq', tipo: 'numero' },
    { chave: 'peso_bruto', label: 'Peso bruto', tipo: 'numero' },
    { chave: 'localizacao', label: 'Localização', tipo: 'texto' },
    { chave: 'ncm', label: 'NCM', tipo: 'texto' },
    { chave: 'cest', label: 'CEST', tipo: 'texto' },
    { chave: 'observacoes', label: 'Obs', tipo: 'texto' },
    { chave: 'status', label: 'Status', tipo: 'texto' },
    { chave: 'publicado', label: 'Publicado', tipo: 'texto' }
  ]

  const legendaColuna = (chave: string) => TODAS_COLUNAS.find((c) => c.chave === chave)?.label ?? chave

  const LARGURAS_PADRAO: Record<string, number> = {
    acoes: 100,
    imagem: 70,
    nome: 180,
    codigo: 110,
    codigo_extra: 100,
    marca: 110,
    categoria: 130,
    subcategoria: 120,
    fornecedor: 120,
    unidade: 70,
    custo: 90,
    venda: 90,
    promo: 90,
    atacado1: 90,
    atacado2: 90,
    qtdmin1: 80,
    qtdmin2: 80,
    estoque: 80,
    estoque_min: 90,
    estoque_max: 90,
    peso_liq: 80,
    peso_bruto: 90,
    localizacao: 110,
    ncm: 90,
    cest: 90,
    observacoes: 150,
    status: 80,
    publicado: 90
  }

  const larguraCol = (chave: string) => largurasColunas[chave] ?? LARGURAS_PADRAO[chave]

  const moverColuna = (origem: string, destino: string) => {
    if (origem === destino) return
    setOrdemColunas((prev) => {
      const novo = [...prev]
      const idxO = novo.indexOf(origem)
      const idxD = novo.indexOf(destino)
      if (idxO === -1 || idxD === -1) return prev
      novo.splice(idxO, 1)
      novo.splice(idxD, 0, origem)
      localStorage.setItem('produtos_colunas', JSON.stringify(novo))
      return novo
    })
  }

  const COLUNAS_PADRAO_PRODUTOS = ['acoes', 'imagem', 'nome', 'codigo', 'marca', 'categoria', 'custo', 'venda', 'estoque', 'status']

  const restaurarColunas = () => {
    setOrdemColunas([...COLUNAS_PADRAO_PRODUTOS])
    setLargurasColunas({})
    try {
      localStorage.setItem('produtos_colunas', JSON.stringify(COLUNAS_PADRAO_PRODUTOS))
      localStorage.setItem('produtos_larguras', JSON.stringify({}))
    } catch {
      // ignore
    }
    setMensagem('Colunas restauradas ao padrão.')
  }

  const alternarColuna = (chave: string) => {
    if (chave === 'acoes') return
    setOrdemColunas((prev) => {
      const novo = prev.includes(chave) ? prev.filter((c) => c !== chave) : [...prev, chave]
      localStorage.setItem('produtos_colunas', JSON.stringify(novo))
      return novo
    })
  }

  const ordenar = (chave: string) => {
    setOrdem((prev) => {
      if (prev && prev.chave === chave) {
        return prev.dir === 'asc' ? { chave, dir: 'desc' } : null
      }
      return { chave, dir: 'asc' }
    })
  }

  const ordenarProdutos = (lista: Produto[]) => {
    if (!ordem || ordem.chave === 'acoes' || ordem.chave === 'imagem') return lista
    const { chave, dir } = ordem
    const mult = dir === 'asc' ? 1 : -1
    return [...lista].sort((a, b) => {
      const va = valorColuna(a, chave)
      const vb = valorColuna(b, chave)
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mult
      return String(va ?? '').localeCompare(String(vb ?? ''), 'pt-BR') * mult
    })
  }
  const produtosOrdenados = ordenarProdutos(produtosExibidos)

  useEffect(() => {
    const visiveis = produtosExibidos.map((p) => p.id)
    if (!visiveis.length) return
    let cancelado = false
    const carregarLote = async (inicio: number) => {
      const fim = Math.min(inicio + 15, visiveis.length)
      const lote = visiveis.slice(inicio, fim)
      if (!lote.length || cancelado) return
      try {
        const imgs = await getImagemApi().listPorIds(lote)
        if (cancelado) return
        setImagensMap((prev) => {
          const novo = { ...prev }
          for (const [k, v] of Object.entries(imgs)) if (v) novo[Number(k)] = v
          return novo
        })
      } catch { /* ignore */ }
      if (!cancelado && fim < visiveis.length) {
        setTimeout(() => carregarLote(fim), 15)
      }
    }
    carregarLote(0)
    return () => { cancelado = true }
  }, [busca, limite, paginaAtual, produtos.length])

  const carregar = useCallback(async () => {
    const db = getDbApi()
    const condicoes: string[] = []
    const params: unknown[] = []
    if (filtroStatus === 'ativos') condicoes.push(`p.ativo = 1`)
    if (filtroStatus === 'inativos') condicoes.push(`p.ativo = 0`)
    if (filtroEspecial === 'abaixo_min') condicoes.push(`p.controla_estoque = 1 AND p.estoque <= p.estoque_minimo`)
    if (filtroEspecial === 'pedidos_abertos') {
      condicoes.push(`EXISTS (
        SELECT 1 FROM pedido_itens pi2
        JOIN pedidos p2 ON p2.id = pi2.pedido_id
        WHERE pi2.produto_id = p.id AND p2.status NOT IN ('entregue', 'cancelado')
      )`)
    }
    if (categoriaSel != null) condicoes.push(`p.categoria_id = ?`)
    if (categoriaSel != null) params.push(categoriaSel)
    if (subcategoriaSel != null) condicoes.push(`p.subcategoria_id = ?`)
    if (subcategoriaSel != null) params.push(subcategoriaSel)
    const termo = busca.trim()
    if (termo) {
      if (buscaAvancada) {
        const palavras = termo.split(/\s+/).filter(Boolean)
        const condCampos = `(p.nome LIKE ? OR m.nome LIKE ? OR p.codigo_barras LIKE ? OR p.codigo_interno LIKE ?
                             OR p.codigo_extra LIKE ? OR p.descricao LIKE ? OR s.nome LIKE ? OR c.nome LIKE ? OR p.localizacao LIKE ?)`
        for (const w of palavras) {
          condicoes.push(condCampos)
          const like = `%${w}%`
          params.push(like, like, like, like, like, like, like, like, like)
        }
      } else {
        condicoes.push(`(p.nome LIKE ? OR p.codigo_barras LIKE ? OR m.nome LIKE ? OR c.nome LIKE ?)`)
        const like = `%${termo}%`
        params.push(like, like, like, like)
      }
    }
    const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : ''
    const rows = (await db.all(
      `SELECT p.id, p.nome, p.codigo_barras, p.codigo_interno, p.codigo_extra, p.categoria_id, p.subcategoria_id,
              p.marca_id, p.fornecedor_id, p.preco_custo, p.preco_venda, p.preco_promo, p.preco_atacado1,
              p.preco_atacado2, p.qtd_min_atacado1, p.qtd_min_atacado2, p.estoque, p.estoque_minimo,
              p.estoque_maximo, p.unidade, p.ativo, p.promocional, p.controla_estoque, p.permite_fracionado,
              p.localizacao, p.peso_liq, p.peso_bruto, p.observacoes, p.preco_automatico, p.preco_alteravel,
              p.ncm, p.cest, p.exportar_balanca, p.descricao, p.publicado, p.catalogo_publicado, p.catalogo_ordem, p.criado_em,
              c.nome AS categoria_nome, m.nome AS marca_nome, s.nome AS subcategoria_nome, f.nome AS fornecedor_nome
       FROM produtos p
       LEFT JOIN categorias c ON c.id = p.categoria_id
       LEFT JOIN marcas m ON m.id = p.marca_id
       LEFT JOIN subcategorias s ON s.id = p.subcategoria_id
       LEFT JOIN fornecedores f ON f.id = p.fornecedor_id
       ${where}
       ORDER BY p.nome`,
      params
    )) as unknown as Produto[]
    const lista = rows.map((p) => ({ ...p, imagem: null }))
    setProdutos(lista)
    setPaginaAtual(1)
  }, [busca, buscaAvancada, filtroStatus, filtroEspecial, categoriaSel, subcategoriaSel])

  useEffect(() => {
    carregar()
  }, [carregar])

  useEffect(() => {
    const fechar = (e: MouseEvent) => {
      const alvo = e.target as HTMLElement
      if (!alvo.closest('.dropdown-filtro')) { setFiltrosAbertos(false); setMenuLayout(false) }
    }
    window.addEventListener('mousedown', fechar)
    return () => window.removeEventListener('mousedown', fechar)
  }, [])

  useEffect(() => {
    if (wrapProdRef.current) wrapProdRef.current.scrollTop = 0
  }, [paginaAtual, limite])

  useEffect(() => {
    getDbApi().all('SELECT id, nome FROM categorias ORDER BY nome').then((rows) => {
      setCategorias(rows as unknown as Categoria[])
    })
    getDbApi().all('SELECT id, categoria_id, nome FROM subcategorias ORDER BY nome').then((rows) => {
      setSubcategorias(rows as unknown as Subcategoria[])
    })
    getDbApi().all('SELECT id, nome FROM marcas ORDER BY nome').then((rows) => {
      setMarcas(rows as unknown as Marca[])
    })
  }, [])

  useEffect(() => {
    if (formAberto) {
      setAba('cadastro')
      setTimeout(() => nomeRef.current?.focus(), 50)
    }
  }, [formAberto])

  useEffect(() => {
    const t = setTimeout(() => sincronizarScrollbarProd(), 200)
    return () => clearTimeout(t)
  }, [produtos.length, limite, ordemColunas])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const r = redimProdRef.current
      if (!r) return
      const nova = Math.max(60, r.startW + (e.clientX - r.startX))
      setLargurasColunas((prev) => {
        const novo = { ...prev, [r.chave]: nova }
        try { localStorage.setItem('produtos_larguras', JSON.stringify(novo)) } catch { /* ignore */ }
        return novo
      })
    }
    const onUp = () => {
      redimProdRef.current = null
      document.body.classList.remove('resizing-cols')
      setTimeout(() => sincronizarScrollbarProd(), 50)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const iniciarRedim = (chave: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const atual = largurasColunas[chave] ?? LARGURAS_PADRAO[chave] ?? 120
    redimProdRef.current = { chave, startX: e.clientX, startW: atual }
    document.body.classList.add('resizing-cols')
  }

  const abrirNovo = () => {
    setForm({ ...produtoVazio })
    formOriginalRef.current = { ...produtoVazio }
    setEditandoId(null)
    setImagemPreview(null)
    setLimiteEstoque('Padrão')
    setFormAberto(true)
    setMensagem('')
  }

  const abrirEdicao = async (p: Produto) => {
    const img = await getImagemApi().get(p.id)
    setForm({
      nome: p.nome,
      codigo_barras: p.codigo_barras ?? '',
      codigo_interno: p.codigo_interno ?? '',
      codigo_extra: p.codigo_extra ?? '',
      codigo_automatico: p.codigo_interno ? 0 : 1,
      categoria_id: p.categoria_id ? String(p.categoria_id) : '',
      subcategoria_id: p.subcategoria_id ? String(p.subcategoria_id) : '',
      marca_id: p.marca_id ? String(p.marca_id) : '',
      fornecedor_id: p.fornecedor_id ? String(p.fornecedor_id) : '',
      preco_custo: formatarMoeda(p.preco_custo),
      preco_venda: formatarMoeda(p.preco_venda),
      preco_promo: p.preco_promo != null ? formatarMoeda(p.preco_promo) : '',
      preco_atacado1: p.preco_atacado1 != null ? formatarMoeda(p.preco_atacado1) : '',
      preco_atacado2: p.preco_atacado2 != null ? formatarMoeda(p.preco_atacado2) : '',
      qtd_min_atacado1: p.qtd_min_atacado1 != null ? String(p.qtd_min_atacado1) : '',
      qtd_min_atacado2: p.qtd_min_atacado2 != null ? String(p.qtd_min_atacado2) : '',
      preco_automatico: p.preco_automatico,
      preco_alteravel: p.preco_alteravel,
      promocional: p.promocional,
      estoque: String(p.estoque),
      estoque_minimo: String(p.estoque_minimo),
      estoque_maximo: p.estoque_maximo != null ? String(p.estoque_maximo) : '',
      controla_estoque: p.controla_estoque,
      permite_fracionado: p.permite_fracionado,
      unidade: p.unidade,
      localizacao: p.localizacao ?? '',
      peso_liq: p.peso_liq != null ? String(p.peso_liq) : '',
      peso_bruto: p.peso_bruto != null ? String(p.peso_bruto) : '',
      observacoes: p.observacoes ?? '',
      ativo: p.ativo,
      catalogo_publicado: p.catalogo_publicado ?? 1,
      catalogo_ordem: p.catalogo_ordem != null ? String(p.catalogo_ordem) : ''
    })
    formOriginalRef.current = {
      nome: p.nome,
      codigo_barras: p.codigo_barras ?? '',
      codigo_interno: p.codigo_interno ?? '',
      codigo_extra: p.codigo_extra ?? '',
      codigo_automatico: p.codigo_interno ? 0 : 1,
      categoria_id: p.categoria_id ? String(p.categoria_id) : '',
      subcategoria_id: p.subcategoria_id ? String(p.subcategoria_id) : '',
      marca_id: p.marca_id ? String(p.marca_id) : '',
      fornecedor_id: p.fornecedor_id ? String(p.fornecedor_id) : '',
      preco_custo: formatarMoeda(p.preco_custo),
      preco_venda: formatarMoeda(p.preco_venda),
      preco_promo: p.preco_promo != null ? formatarMoeda(p.preco_promo) : '',
      preco_atacado1: p.preco_atacado1 != null ? formatarMoeda(p.preco_atacado1) : '',
      preco_atacado2: p.preco_atacado2 != null ? formatarMoeda(p.preco_atacado2) : '',
      qtd_min_atacado1: p.qtd_min_atacado1 != null ? String(p.qtd_min_atacado1) : '',
      qtd_min_atacado2: p.qtd_min_atacado2 != null ? String(p.qtd_min_atacado2) : '',
      preco_automatico: p.preco_automatico,
      preco_alteravel: p.preco_alteravel,
      promocional: p.promocional,
      estoque: String(p.estoque),
      estoque_minimo: String(p.estoque_minimo),
      estoque_maximo: p.estoque_maximo != null ? String(p.estoque_maximo) : '',
      controla_estoque: p.controla_estoque,
      permite_fracionado: p.permite_fracionado,
      unidade: p.unidade,
      localizacao: p.localizacao ?? '',
      peso_liq: p.peso_liq != null ? String(p.peso_liq) : '',
      peso_bruto: p.peso_bruto != null ? String(p.peso_bruto) : '',
      observacoes: p.observacoes ?? '',
      ativo: p.ativo,
      catalogo_publicado: p.catalogo_publicado ?? 1,
      catalogo_ordem: p.catalogo_ordem != null ? String(p.catalogo_ordem) : ''
    }
    setImagemPreview(img)
    setEditandoId(p.id)
    setFormAberto(true)
    setMensagem('')
  }

  useEffect(() => {
    if (!produtoEdicaoId) return
    const abrir = async () => {
      const row = (await getDbApi().get(
        `SELECT p.*, c.nome AS categoria_nome, m.nome AS marca_nome, s.nome AS subcategoria_nome, f.nome AS fornecedor_nome
         FROM produtos p
         LEFT JOIN categorias c ON c.id = p.categoria_id
         LEFT JOIN marcas m ON m.id = p.marca_id
         LEFT JOIN subcategorias s ON s.id = p.subcategoria_id
         LEFT JOIN fornecedores f ON f.id = p.fornecedor_id
         WHERE p.id = ?`,
        [produtoEdicaoId]
      )) as unknown as Produto | undefined
      if (row) await abrirEdicao(row)
    }
    abrir()
  }, [produtoEdicaoId])

  const gerarCodigoAuto = () => {
    if (form.codigo_interno.trim()) return form.codigo_interno
    const digitos = Math.max(1, Math.min(30, digitosCodigo))
    const num = String(Math.floor(Math.random() * Math.pow(10, digitos))).padStart(digitos, '0')
    return num
  }

  const salvar = async () => {
    if (!form.nome.trim()) {
      setMensagem('Informe o nome do produto.')
      nomeRef.current?.focus()
      return
    }
    const precoVenda = parseMoeda(form.preco_venda)
    if (isNaN(precoVenda) || precoVenda <= 0) {
      setMensagem('Informe um preço de venda válido.')
      return
    }
    if (!form.controla_estoque) {
      if (parseMoeda(form.estoque) !== 0) {
        setMensagem('O estoque atual só pode ser definido com controle de estoque ativo.')
        return
      }
    }
    const db = getDbApi()
    const codigoInterno = form.codigo_automatico ? gerarCodigoAuto() : form.codigo_interno.trim()
    const params = [
      form.nome.trim(),
      form.codigo_barras.trim() || null,
      codigoInterno || null,
      form.codigo_extra.trim() || null,
      form.categoria_id ? Number(form.categoria_id) : null,
      form.subcategoria_id && form.categoria_id ? Number(form.subcategoria_id) : null,
      form.marca_id ? Number(form.marca_id) : null,
      form.fornecedor_id ? Number(form.fornecedor_id) : null,
      parseMoeda(form.preco_custo),
      precoVenda,
      form.preco_promo !== '' ? parseMoeda(form.preco_promo) : null,
      form.promocional,
      form.preco_automatico,
      form.preco_alteravel,
      form.controla_estoque,
      form.controla_estoque ? parseMoeda(form.estoque) : 0,
      form.controla_estoque ? parseMoeda(form.estoque_minimo) : 0,
      form.controla_estoque && form.estoque_maximo !== '' ? parseMoeda(form.estoque_maximo) : null,
      form.unidade || 'un',
      form.permite_fracionado,
      form.localizacao.trim() || null,
      form.peso_liq !== '' ? parseMoeda(form.peso_liq) : null,
      form.peso_bruto !== '' ? parseMoeda(form.peso_bruto) : null,
      form.preco_atacado1 !== '' ? parseMoeda(form.preco_atacado1) : null,
      form.preco_atacado2 !== '' ? parseMoeda(form.preco_atacado2) : null,
      form.qtd_min_atacado1 !== '' ? Number(form.qtd_min_atacado1) : 0,
      form.qtd_min_atacado2 !== '' ? Number(form.qtd_min_atacado2) : 0,
      form.observacoes.trim() || null,
      form.ativo,
      form.catalogo_publicado,
      form.catalogo_ordem !== '' ? Number(form.catalogo_ordem) || 0 : 0
    ]
    let id: number
    if (editandoId) {
      await db.run(
        `UPDATE produtos SET
           nome=?, codigo_barras=?, codigo_interno=?, codigo_extra=?, categoria_id=?, subcategoria_id=?,
           marca_id=?, fornecedor_id=?, preco_custo=?, preco_venda=?, preco_promo=?, promocional=?,
           preco_automatico=?, preco_alteravel=?, controla_estoque=?, estoque=?, estoque_minimo=?,
           estoque_maximo=?, unidade=?, permite_fracionado=?, localizacao=?, peso_liq=?, peso_bruto=?,
           preco_atacado1=?, preco_atacado2=?, qtd_min_atacado1=?, qtd_min_atacado2=?,
           observacoes=?, ativo=?, catalogo_publicado=?, catalogo_ordem=?
         WHERE id=?`,
        [...params, editandoId]
      )
      id = editandoId
    } else {
      const res = await db.run(
        `INSERT INTO produtos (nome, codigo_barras, codigo_interno, codigo_extra, categoria_id, subcategoria_id,
           marca_id, fornecedor_id, preco_custo, preco_venda, preco_promo, promocional,
           preco_automatico, preco_alteravel, controla_estoque, estoque, estoque_minimo,
           estoque_maximo, unidade, permite_fracionado, localizacao, peso_liq, peso_bruto,
           preco_atacado1, preco_atacado2, qtd_min_atacado1, qtd_min_atacado2,
           observacoes, ativo, catalogo_publicado, catalogo_ordem)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params
      )
      id = Number(res.lastInsertRowid)
    }
    if (imagemPreview && !(await getImagemApi().get(id))) {
      setMensagem('Produto salvo. A imagem será definida pela lista de produtos.')
    }
    setFormAberto(false)
    setMensagem(editandoId ? 'Produto atualizado!' : `Produto criado! (código ${codigoInterno})`)
    formOriginalRef.current = { ...form }
    carregar()
  }

  const clonarProduto = async () => {
    if (!editandoId) return
    const db = getDbApi()
    const p = (await db.get(`SELECT * FROM produtos WHERE id = ?`, [editandoId])) as Produto & { nome: string } | undefined
    if (!p) return
    const novo = `CÓPIA - ${p.nome}`
    const cod = `${p.codigo_interno ?? ''}-C`
    await db.run(
      `INSERT INTO produtos (nome, codigo_barras, codigo_interno, categoria_id, subcategoria_id, marca_id, fornecedor_id,
         preco_custo, preco_venda, preco_promo, preco_atacado1, preco_atacado2, qtd_min_atacado1, qtd_min_atacado2,
         estoque, estoque_minimo, unidade, ativo, promocional, controla_estoque, permite_fracionado, localizacao,
         preco_automatico, preco_alteravel, ncm, cest, publicado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 1, ?, 1, ?, ?, ?, ?, ?, ?, 1)`,
      [novo, p.codigo_barras ?? null, cod, p.categoria_id, p.subcategoria_id, p.marca_id, p.fornecedor_id,
       p.preco_custo, p.preco_venda, p.preco_promo, p.preco_atacado1, p.preco_atacado2, p.qtd_min_atacado1, p.qtd_min_atacado2,
       p.estoque_minimo, p.unidade, p.promocional, p.permite_fracionado, p.localizacao, p.preco_automatico, p.preco_alteravel, p.ncm, p.cest]
    )
    setMensagem(`Produto clonado como "${novo}".`)
    setFormAberto(false)
    carregar()
  }

  const excluirProduto = async () => {
    if (!editandoId) return
    if (!confirm(`Excluir o produto "${form.nome}"? Esta ação não pode ser desfeita.`)) return
    await getDbApi().run(`DELETE FROM produtos WHERE id = ?`, [editandoId])
    setMensagem('Produto excluído.')
    setFormAberto(false)
    carregar()
  }

  const escolherImagemForm = async () => {
    if (!editandoId) {
      setMensagem('Salve o produto primeiro e depois adicione a imagem na lista.')
      return
    }
    const img = await getImagemApi().definir(editandoId)
    if (img) setImagemPreview(img)
  }

  const cancelar = () => {
    const alterado = (Object.keys(form) as (keyof typeof form)[]).some(
      (k) => JSON.stringify(form[k]) !== JSON.stringify(formOriginalRef.current[k])
    )
    if (alterado) {
      if (!confirm('Cancelar e descartar as alterações?')) return
    }
    setFormAberto(false)
    setImagemPreview(null)
  }

  const toggleObservacao = () => {
    obsAberto.current = !obsAberto.current
    setMensagem(obsAberto.current ? 'Observação aberta (F4 para fechar).' : '')
  }

  const salvarF2 = () => {
    if (formAberto) salvar()
  }

  const atalhosKey = (e: KeyboardEvent) => {
    if (!formAberto) return
    if (e.key === 'F2') {
      e.preventDefault()
      salvarF2()
    }
    if (e.key === 'F3') {
      e.preventDefault()
      if (editandoId) clonarProduto()
    }
    if (e.key === 'F4') {
      e.preventDefault()
      toggleObservacao()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setFormAberto(false)
    }
  }

  useEffect(() => {
    window.addEventListener('keydown', atalhosKey)
    return () => window.removeEventListener('keydown', atalhosKey)
  }, [formAberto, form, editandoId])

  const subcategoriasDaCategoria = subcategorias.filter(
    (s) => form.categoria_id && s.categoria_id === Number(form.categoria_id)
  )

  const limites = LIMITES_ESTOQUE

  return (
    <div className="page">
      <div className="page-header">
        <h2>Produtos</h2>
        <div className="page-acoes">
          {modo === 'lista' && (
            <button className="btn-primario" onClick={abrirNovo}>+ Novo Produto</button>
          )}
        </div>
      </div>

      <div className="abas-vendas">
        <button className={`aba ${modo === 'lista' ? 'ativa' : ''}`} onClick={() => setModo('lista')}>Produtos</button>
        <button className={`aba ${modo === 'fornecedores' ? 'ativa' : ''}`} onClick={() => setModo('fornecedores')}>Fornecedores</button>
        <button className={`aba ${modo === 'etiquetas' ? 'ativa' : ''}`} onClick={() => setModo('etiquetas')}>Etiquetas</button>
        <button className={`aba ${modo === 'tributacao' ? 'ativa' : ''}`} onClick={() => setModo('tributacao')}>Tributação</button>
        <button className={`aba ${modo === 'importar' ? 'ativa' : ''}`} onClick={() => setModo('importar')}>Importar</button>
      </div>

      {modo === 'lista' && (
        <div className="filtros-vendas produtos-filtros">
          <button
            className={`btn-secundario btn-categorias-lateral ${categoriasLateralAberta ? 'ativo' : ''}`}
            onClick={() => setCategoriasLateralAberta((v) => !v)}
            title="Mostrar/esconder categorias"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 3H2l8 9.46V19l4 2v-8.54z" />
            </svg>
            Categorias
          </button>

          <div className="busca-pdv-caixa produtos-busca-pdv">
            <input
              className="busca-pdv"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder={buscaAvancada ? 'Busca avançada: nome, marca, código, categoria, obs...' : 'Filtrar por nome, código, marca...'}
            />
            <button
              className={`pdv-busca-avancada ${buscaAvancada ? 'ativo' : ''}`}
              onClick={() => { setBuscaAvancada((v) => !v); setBusca('') }}
              title={buscaAvancada ? 'Busca avançada ativa — clique para desativar' : 'Ativar busca avançada (busca em mais campos)'}
            >
              Avançada {buscaAvancada ? 'ON' : 'OFF'}
            </button>
          </div>

          <div className="dropdown-filtro produtos-filtro-menu">
            <button
              className={`btn-secundario btn-funil ${filtrosAbertos ? 'ativo' : ''}`}
              onClick={() => setFiltrosAbertos((v) => !v)}
              title="Filtros"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              Filtros
            </button>
            {filtrosAbertos && (
              <div className="dropdown-colunas-menu produtos-filtros-drop">
                <div className="dropdown-colunas-titulo">Filtros de produtos</div>
                <label className="dropdown-colunas-item">
                  Status
                  <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as 'todos' | 'ativos' | 'inativos')}>
                    <option value="ativos">Produtos ativos</option>
                    <option value="inativos">Produtos inativos</option>
                    <option value="todos">Todos os produtos</option>
                  </select>
                </label>
                <label className="dropdown-colunas-item">
                  Condição
                  <select value={filtroEspecial} onChange={(e) => setFiltroEspecial(e.target.value as 'nenhum' | 'abaixo_min' | 'pedidos_abertos')}>
                    <option value="nenhum">Sem filtro especial</option>
                    <option value="abaixo_min">Estoque abaixo do mínimo</option>
                    <option value="pedidos_abertos">Com pedidos em aberto</option>
                  </select>
                </label>
              </div>
            )}
          </div>
        </div>
      )}

      {mensagem && <div className="mensagem">{mensagem}</div>}

      {modo === 'importar' && (
        <ImportarProdutos onConcluido={() => { carregar(); setModo('lista') }} />
      )}

      {modo === 'fornecedores' && (
        <Fornecedores onConcluido={() => carregar()} />
      )}

      {modo === 'etiquetas' && (
        <div className="page">
          <h3>Categorias / Etiquetas</h3>
          <p className="sem-resultado">Impressão de etiquetas por categoria — em breve.</p>
        </div>
      )}

      {modo === 'tributacao' && (
        <div className="page">
          <h3>Tributação dos produtos</h3>
          <p className="sem-resultado">Configuração tributária dos produtos — em breve.</p>
        </div>
      )}

      {modo === 'lista' && (
        <div className="produtos-lista-area">
      {formAberto && (
        <div className="modal-overlay" onClick={cancelar}>
          <div className="modal modal-produto" onClick={(e) => e.stopPropagation()}>
            <div className="modal-produto-topo">
              <div className="abas-produto">
                {(['cadastro', 'transacoes', 'combo', 'tributacao', 'fornecedores', 'opcoes', 'validade'] as AbaProduto[]).map((a) => (
                  <button
                    key={a}
                    className={`aba-produto ${aba === a ? 'ativa' : ''}`}
                    onClick={() => setAba(a)}
                  >
                    {a === 'cadastro' ? 'Cadastro' : a === 'transacoes' ? 'Transações' : a === 'combo' ? 'Kit / Combo' : a === 'tributacao' ? 'Tributação' : a === 'fornecedores' ? 'Fornecedores' : a === 'opcoes' ? 'Opções' : 'Controle de validade'}
                  </button>
                ))}
              </div>
              <button className="modal-fechar" onClick={cancelar} title="Fechar">X</button>
            </div>

            {aba === 'cadastro' && (
              <div className="modal-produto-corpo">
                <div className="produto-lado-esq">
                  <div className="produto-identificacao">
                    <div className="form-grid">
                      <label>Código
                        <div className="campo-codigo">
                          <input
                            value={form.codigo_interno}
                            disabled={!!form.codigo_automatico}
                            onChange={(e) => setForm({ ...form, codigo_interno: e.target.value })}
                            placeholder={form.codigo_automatico ? 'Gerado automaticamente' : ''}
                          />
                          <label className="check-inline">
                            <input
                              type="checkbox"
                              checked={!!form.codigo_automatico}
                              onChange={(e) => setForm({ ...form, codigo_automatico: e.target.checked ? 1 : 0 })}
                            />
                            Automático
                          </label>
                        </div>
                      </label>
                      <label>Código Extra
                        <input
                          value={form.codigo_extra}
                          onChange={(e) => setForm({ ...form, codigo_extra: e.target.value })}
                        />
                      </label>
                      <label>EAN / GTIN
                        <input
                          value={form.codigo_barras}
                          onChange={(e) => setForm({ ...form, codigo_barras: e.target.value })}
                          placeholder="Código de barras"
                        />
                      </label>
                    </div>
                    <label className="campo-nome">Nome
                      <input
                        ref={nomeRef}
                        value={form.nome}
                        onChange={(e) => setForm({ ...form, nome: e.target.value })}
                        autoFocus
                      />
                    </label>
                  </div>

                  <div className="produto-separador" />

                  <div className="produto-classificacao">
                    <div className="form-grid">
                      <label>Categoria
                        <select
                          value={form.categoria_id}
                          onChange={(e) => {
                            setForm({ ...form, categoria_id: e.target.value, subcategoria_id: '' })
                          }}
                        >
                          <option value="">Selecione</option>
                          {categorias.map((c) => (
                            <option key={c.id} value={c.id}>{c.nome}</option>
                          ))}
                        </select>
                      </label>
                      <label>Peso Líquido
                        <input
                          type="number"
                          step="0.001"
                          value={form.peso_liq}
                          onChange={(e) => setForm({ ...form, peso_liq: e.target.value })}
                        />
                      </label>
                      <label>Subcategoria
                        <select
                          value={form.subcategoria_id}
                          disabled={!form.categoria_id}
                          onChange={(e) => setForm({ ...form, subcategoria_id: e.target.value })}
                        >
                          <option value="">{form.categoria_id ? 'Selecione' : 'Escolha a categoria'}</option>
                          {subcategoriasDaCategoria.map((s) => (
                            <option key={s.id} value={s.id}>{s.nome}</option>
                          ))}
                        </select>
                      </label>
                      <label>Peso Bruto
                        <input
                          type="number"
                          step="0.001"
                          value={form.peso_bruto}
                          onChange={(e) => setForm({ ...form, peso_bruto: e.target.value })}
                        />
                      </label>
                      <label>Marca
                        <select
                          value={form.marca_id}
                          onChange={(e) => setForm({ ...form, marca_id: e.target.value })}
                        >
                          <option value="">Selecione</option>
                          {marcas.map((m) => (
                            <option key={m.id} value={m.id}>{m.nome}</option>
                          ))}
                        </select>
                      </label>
                      <label>Localização
                        <input
                          value={form.localizacao}
                          onChange={(e) => setForm({ ...form, localizacao: e.target.value })}
                          placeholder="Ex: prateleira A2"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="produto-separador" />

                  <div className="produto-precos">
                    <h4>Preços</h4>
                    <div className="form-grid">
                      <label>Preço de Venda (R$)
                        <CampoDinheiro value={form.preco_venda} onChange={(v) => setForm({ ...form, preco_venda: v })} />
                      </label>
                      <div className="preco-opcoes">
                        <label className="check-inline promocional">
                          <input
                            type="checkbox"
                            checked={!!form.promocional}
                            onChange={(e) => setForm({ ...form, promocional: e.target.checked ? 1 : 0 })}
                          />
                          PROMO
                        </label>
                        {!!form.promocional && (
                          <CampoDinheiro value={form.preco_promo} onChange={(v) => setForm({ ...form, preco_promo: v })} placeholder="Preço promo" />
                        )}
                      </div>
                      <label className="check-inline">
                        <input
                          type="checkbox"
                          checked={!!form.preco_automatico}
                          onChange={(e) => setForm({ ...form, preco_automatico: e.target.checked ? 1 : 0 })}
                        />
                        Automático
                      </label>
                      <label className="check-inline">
                        <input
                          type="checkbox"
                          checked={!!form.preco_alteravel}
                          onChange={(e) => setForm({ ...form, preco_alteravel: e.target.checked ? 1 : 0 })}
                        />
                        Preço alterável na venda
                      </label>
                      <label>Preço de Custo (R$)
                        <CampoDinheiro value={form.preco_custo} onChange={(v) => setForm({ ...form, preco_custo: v })} />
                      </label>
                      <label>Preço Atacado 1 (R$)
                        <CampoDinheiro value={form.preco_atacado1} onChange={(v) => setForm({ ...form, preco_atacado1: v })} />
                      </label>
                      <label>Qtd mín. Atacado 1
                        <input
                          type="text"
                          inputMode="decimal"
                          value={form.qtd_min_atacado1}
                          onChange={(e) => setForm({ ...form, qtd_min_atacado1: e.target.value.replace(',', '.') })}
                          placeholder="Ex: 10"
                        />
                      </label>
                      <label>Preço Atacado 2 (R$)
                        <CampoDinheiro value={form.preco_atacado2} onChange={(v) => setForm({ ...form, preco_atacado2: v })} />
                      </label>
                      <label>Qtd mín. Atacado 2
                        <input
                          type="text"
                          inputMode="decimal"
                          value={form.qtd_min_atacado2}
                          onChange={(e) => setForm({ ...form, qtd_min_atacado2: e.target.value.replace(',', '.') })}
                          placeholder="Ex: 50"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="produto-separador" />

                  <div className="produto-estoque">
                    <div className="linha-controle-estoque">
                      <span>Controlar Estoque</span>
                      <button
                        className={`switch ${form.controla_estoque ? 'ativo' : ''}`}
                        onClick={() => setForm({ ...form, controla_estoque: form.controla_estoque ? 0 : 1 })}
                        role="switch"
                        aria-checked={!!form.controla_estoque}
                      >
                        <span className="switch-bola" />
                      </button>
                    </div>
                    {!!form.controla_estoque && (
                      <div className="form-grid">
                        <label>Estoque Atual
                          <input
                            type="number"
                            step="0.01"
                            value={form.estoque}
                            onChange={(e) => setForm({ ...form, estoque: e.target.value })}
                          />
                        </label>
                        <label>Limites estoque
                          <select value={limiteEstoque} onChange={(e) => setLimiteEstoque(e.target.value)}>
                            {limites.map((l) => (
                              <option key={l} value={l}>{l}</option>
                            ))}
                          </select>
                        </label>
                        <label>Estoque mínimo
                          <input
                            type="number"
                            step="0.01"
                            value={form.estoque_minimo}
                            onChange={(e) => setForm({ ...form, estoque_minimo: e.target.value })}
                          />
                        </label>
                        <label>Estoque máximo
                          <input
                            type="number"
                            step="0.01"
                            value={form.estoque_maximo}
                            onChange={(e) => setForm({ ...form, estoque_maximo: e.target.value })}
                          />
                        </label>
                        <label>Unidade Medida
                          <select
                            value={form.unidade}
                            onChange={(e) => setForm({ ...form, unidade: e.target.value })}
                          >
                            <option value="un">un</option>
                            <option value="pct">pct</option>
                            <option value="g">g</option>
                            <option value="kg">kg</option>
                            <option value="ml">ml</option>
                            <option value="l">L</option>
                          </select>
                        </label>
                        <label className="check-inline fracionado">
                          <input
                            type="checkbox"
                            checked={!!form.permite_fracionado}
                            onChange={(e) => setForm({ ...form, permite_fracionado: e.target.checked ? 1 : 0 })}
                          />
                          Permite fracionamento (Ex: venda por peso/kg)
                        </label>
                      </div>
                    )}
                  </div>
                </div>

                <div className="produto-lado-dir">
                  <div
                    className={`produto-imagem-box ${imagemPreview ? 'tem-imagem' : ''}`}
                    onClick={escolherImagemForm}
                    title={imagemPreview ? 'Clique para trocar a imagem' : 'Clique para adicionar imagem'}
                  >
                    {imagemPreview ? (
                      <img src={`data:image/png;base64,${imagemPreview}`} alt="Produto" />
                    ) : (
                      <div className="produto-imagem-vazio">
                        <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 6h5l2-2h2l2 2h5a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" />
                          <path d="M12 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
                        </svg>
                        <span>Adicionar imagem</span>
                      </div>
                    )}
                  </div>
                  {imagemPreview && (
                    <button className="btn-mini btn-remover-foto" onClick={async () => { await getImagemApi().remover(editandoId!); setImagemPreview(null); }}>
                      Remover foto
                    </button>
                  )}
                  <button className="btn-secundario btn-adicionar-foto" onClick={escolherImagemForm}>
                    {imagemPreview ? 'Trocar foto' : '📷 Adicionar foto'}
                  </button>
                  <button className="link-observacao" onClick={toggleObservacao}>
                    {obsAberto.current ? 'Fechar Observação' : 'Adicionar Observação'} <kbd>F4</kbd>
                  </button>
                  {obsAberto.current && (
                    <textarea
                      className="observacao-textarea"
                      rows={5}
                      value={form.observacoes}
                      onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
                      placeholder="Observações sobre o produto..."
                    />
                  )}
                </div>
              </div>
            )}

            {aba === 'combo' && <EmBreveAba titulo="Kit / Combo" />}
            {aba === 'transacoes' && <TransacoesProduto produtoId={editandoId} />}
            {aba === 'tributacao' && <EmBreveAba titulo="Tributação" />}
            {aba === 'fornecedores' && (
              <div className="aba-conteudo">
                <h4>Fornecedores</h4>
                <p className="sem-resultado">Associação de fornecedores ao produto (em breve).</p>
              </div>
            )}
            {aba === 'opcoes' && (
              <div className="aba-conteudo">
                <h4>Opções</h4>
                <div className="form-grid">
                  <label className="check-inline">
                    <input type="checkbox" checked={!!form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked ? 1 : 0 })} />
                    Produto ativo
                  </label>
                  <label className="check-inline">
                    <input type="checkbox" checked={!!form.catalogo_publicado} onChange={(e) => setForm({ ...form, catalogo_publicado: e.target.checked ? 1 : 0 })} />
                    Publicar no catálogo online
                  </label>
                  <label>Ordem de exibição no catálogo
                    <input type="number" value={form.catalogo_ordem} onChange={(e) => setForm({ ...form, catalogo_ordem: e.target.value })} placeholder="0" />
                  </label>
                </div>
                <p className="nota-config">Produtos com "Publicar no catálogo" marcado são enviados ao site público. Os demais ficam só no sistema.</p>
              </div>
            )}
            {aba === 'validade' && <EmBreveAba titulo="Controle de validade" />}

            <div className="modal-produto-rodape">
              <button className="btn-primario" onClick={salvar}>SALVAR <kbd>F2</kbd></button>
              <button className="btn-secundario" onClick={cancelar}>CANCELAR</button>
              <div className="modal-acoes-direita">
                {editandoId && (
                  <>
                    <button className="forn-link-inativar" onClick={() => setForm({ ...form, ativo: form.ativo ? 0 : 1 })}>
                      {form.ativo ? 'Inativar Produto' : 'Ativar Produto'}
                    </button>
                    <button className="forn-link-inativar" onClick={clonarProduto}>Clonar <kbd>F3</kbd></button>
                    <button className="forn-link-excluir" onClick={excluirProduto}>🗑 Excluir Produto</button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <aside className={`produtos-lateral-categorias ${categoriasLateralAberta ? 'aberta' : ''}`}>
        <div className="produtos-lateral-titulo">
          <strong>Categorias</strong>
          {categoriaSel != null && (
            <button className="btn-mini" onClick={() => { setCategoriaSel(null); setSubcategoriaSel(null) }}>Limpar</button>
          )}
        </div>
        <button
          className={`produtos-cat-item ${categoriaSel == null ? 'ativo' : ''}`}
          onClick={() => { setCategoriaSel(null); setSubcategoriaSel(null) }}
        >
          Todas as categorias
        </button>
        {categorias.map((cat) => {
          const subs = subcategorias.filter((s) => s.categoria_id === cat.id)
          const expandida = !!categoriasExpandidas[cat.id] || categoriaSel === cat.id
          return (
            <div key={cat.id} className="produtos-cat-grupo">
              <div className={`produtos-cat-item ${categoriaSel === cat.id ? 'ativo' : ''}`}>
                {subs.length > 0 && (
                  <button
                    className="produtos-cat-seta"
                    onClick={() => setCategoriasExpandidas((prev) => ({ ...prev, [cat.id]: !prev[cat.id] }))}
                  >
                    {expandida ? '−' : '+'}
                  </button>
                )}
                <button
                  className="produtos-cat-nome"
                  onClick={() => { setCategoriaSel(cat.id); setSubcategoriaSel(null) }}
                >
                  {cat.nome}
                </button>
              </div>
              {expandida && subs.length > 0 && (
                <div className="produtos-subcat-lista">
                  {subs.map((s) => (
                    <button
                      key={s.id}
                      className={`produtos-subcat-item ${subcategoriaSel === s.id ? 'ativo' : ''}`}
                      onClick={() => { setCategoriaSel(cat.id); setSubcategoriaSel(s.id) }}
                    >
                      {s.nome}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {categorias.length === 0 && <p className="sem-resultado">Nenhuma categoria.</p>}
      </aside>

      <div className="produtos-lista-conteudo">
      <div className="produtos-lista-toolbar">
        <button className="btn-secundario" onClick={() => setColunasAbertas((v) => !v)}>
          Colunas ({ordemColunas.length})
        </button>
        <div className="dropdown-filtro produtos-layout-menu">
          <button className="btn-secundario" onClick={() => setMenuLayout((v) => !v)} title="Layout e configurações">⋯</button>
          {menuLayout && (
            <div className="dropdown-colunas-menu">
              <div className="dropdown-colunas-titulo">Layout e configurações</div>
              <button className="dropdown-colunas-item" onClick={() => {
                try {
                  localStorage.setItem('produtos_colunas', JSON.stringify(ordemColunas))
                  localStorage.setItem('produtos_larguras', JSON.stringify(largurasColunas))
                } catch { /* ignore */ }
                setMenuLayout(false)
                setMensagem('Layout das colunas salvo para sempre.')
              }}>
                💾 Salvar layout das colunas
              </button>
              <button className="dropdown-colunas-item" onClick={() => { setMenuLayout(false); setModalConfig(true) }}>
                ⚙ Configurações
              </button>
            </div>
          )}
        </div>
        {colunasAbertas && (
          <div className="colunas-seletor">
            <div className="colunas-seletor-toolbar">
              <span className="nota-config">Arraste os cabeçalhos para reordenar • Clique para ordenar</span>
              <button className="btn-mini" onClick={restaurarColunas}>↺ Restaurar padrão</button>
            </div>
            <div className="colunas-seletor-lista">
              {TODAS_COLUNAS.map((c) => (
                <label key={c.chave} className="check-inline">
                  <input
                    type="checkbox"
                    checked={ordemColunas.includes(c.chave)}
                    disabled={c.chave === 'acoes'}
                    onChange={() => alternarColuna(c.chave)}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </div>
        )}
        <span className="nota-config">Arraste os cabeçalhos para reordenar • Clique para ordenar</span>
      </div>

      <div className="tabela-wrap" ref={wrapProdRef} onScroll={sincronizarScrollbarProd}>
      <table className="tabela tabela-produtos">
        <thead>
          <tr>
            {ordemColunas.map((col) => (
              <th
                key={col}
                className="col-drag"
                draggable
                style={{ width: larguraCol(col) }}
                onDragStart={() => setColunaArrastando(col)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => { if (colunaArrastando) moverColuna(colunaArrastando, col); setColunaArrastando(null) }}
                onClick={() => ordenar(col)}
                title="Arraste para reordenar • Clique para ordenar"
              >
                {legendaColuna(col)}
                {ordem?.chave === col && (ordem.dir === 'asc' ? ' ▲' : ' ▼')}
                <span className="col-resizer" onMouseDown={(e) => iniciarRedim(col, e)} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {produtosOrdenados.map((p) => (
            <tr key={p.id}>
              {ordemColunas.map((col) => (
                <td key={col} className={col === 'acoes' ? 'td-acoes' : col === 'imagem' ? 'td-imagem' : undefined}>
                  {col === 'acoes' ? (
                    <>
                      <button className="btn-editar-produto" onClick={() => abrirEdicao(p)} title="Abrir para editar (inclusive a foto)">
                        ✏️ Editar
                      </button>
                    </>
                  ) : col === 'imagem' ? (
                    imagensMap[p.id] ? (
                      <img className="prod-imagem" loading="lazy" src={`data:image/png;base64,${imagensMap[p.id]}`} alt={p.nome} />
                    ) : (
                      <span className="sem-imagem">-</span>
                    )
                  ) : (
                    renderCelula(p, col)
                  )}
                </td>
              ))}
            </tr>
          ))}
          {produtos.length === 0 && (
            <tr><td colSpan={ordemColunas.length} className="sem-resultado">Nenhum produto encontrado.</td></tr>
          )}
        </tbody>
      </table>
      </div>
      <div className="tabela-scrollbar-fixo" ref={scrollbarProdRef} onScroll={onScrollbarProd}>
        <div className="tabela-scrollbar-fixo-fill" />
      </div>
      <div className="produtos-rodape-lista">
        <div className="produtos-qtd-select">
          <span className="nota-config">Exibir:</span>
          <select value={limite} onChange={(e) => { setLimite(Number(e.target.value)); setPaginaAtual(1) }}>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="200">200</option>
            <option value="500">500</option>
            <option value="100000">Todos</option>
          </select>
          <span className="nota-config">({produtos.length} encontrados)</span>
        </div>
        {(() => {
          const totalPaginas = Math.max(1, Math.ceil(produtos.length / limite))
          const paginas: (number | '...')[] = []
          const atual = Math.min(paginaAtual, totalPaginas)
          if (totalPaginas <= 7) {
            for (let i = 1; i <= totalPaginas; i++) paginas.push(i)
          } else {
            paginas.push(1)
            if (atual > 3) paginas.push('...')
            for (let i = Math.max(2, atual - 1); i <= Math.min(totalPaginas - 1, atual + 1); i++) paginas.push(i)
            if (atual < totalPaginas - 2) paginas.push('...')
            paginas.push(totalPaginas)
          }
          return (
            <div className="produtos-paginacao">
              <button className="btn-mini" disabled={paginaAtual <= 1} onClick={() => setPaginaAtual((p) => Math.max(1, p - 1))}>‹</button>
              {paginas.map((pg, i) =>
                pg === '...' ? <span key={`e${i}`} className="produtos-paginacao-elipse">…</span> : (
                  <button key={pg} className={`btn-mini ${paginaAtual === pg ? 'ativo' : ''}`} onClick={() => setPaginaAtual(pg)}>{pg}</button>
                )
              )}
              <button className="btn-mini" disabled={paginaAtual >= totalPaginas} onClick={() => setPaginaAtual((p) => Math.min(totalPaginas, p + 1))}>›</button>
            </div>
          )
        })()}
      </div>
      </div>
      </div>
      )}

      {modalConfig && (
        <div className="modal-overlay" onClick={() => setModalConfig(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-topo">
              <h3>Configurações de Produtos</h3>
              <button className="btn-icone" onClick={() => setModalConfig(false)}>✕</button>
            </div>
            <div className="form-grid">
              <label style={{ gridColumn: '1 / -1' }}>Dígitos do código do produto
                <div className="produto-digitos-codigo">
                  <button className="btn-secundario" onClick={() => setDigitosCodigo((v) => Math.min(30, v + 1))} title="Aumentar">+</button>
                  <strong>{digitosCodigo} dígitos</strong>
                  <button className="btn-secundario" onClick={() => setDigitosCodigo((v) => Math.max(1, v - 1))} title="Diminuir">−</button>
                </div>
                <small className="nota-config">Os códigos gerados automaticamente terão entre 1 e 30 dígitos. Padrão: 6.</small>
              </label>
            </div>
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => setModalConfig(false)}>Cancelar</button>
              <button className="btn-primario" onClick={() => {
                try { localStorage.setItem('produtos_digitos_codigo', String(digitosCodigo)) } catch { /* ignore */ }
                setModalConfig(false)
                setMensagem(`Configuração salva: código com ${digitosCodigo} dígitos.`)
              }}>Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function valorColuna(p: Produto, chave: string): string | number {
  switch (chave) {
    case 'nome': return p.nome
    case 'codigo': return p.codigo_barras ?? p.codigo_interno ?? ''
    case 'codigo_extra': return p.codigo_extra ?? ''
    case 'marca': return p.marca_nome ?? ''
    case 'categoria': return p.categoria_nome ?? ''
    case 'subcategoria': return p.subcategoria_nome ?? ''
    case 'fornecedor': return p.fornecedor_nome ?? ''
    case 'unidade': return p.unidade
    case 'custo': return p.preco_custo
    case 'venda': return p.preco_venda
    case 'promo': return p.preco_promo ?? 0
    case 'atacado1': return p.preco_atacado1 ?? 0
    case 'atacado2': return p.preco_atacado2 ?? 0
    case 'qtdmin1': return p.qtd_min_atacado1 ?? 0
    case 'qtdmin2': return p.qtd_min_atacado2 ?? 0
    case 'estoque': return p.estoque
    case 'estoque_min': return p.estoque_minimo
    case 'estoque_max': return p.estoque_maximo ?? 0
    case 'peso_liq': return p.peso_liq ?? 0
    case 'peso_bruto': return p.peso_bruto ?? 0
    case 'localizacao': return p.localizacao ?? ''
    case 'ncm': return p.ncm ?? ''
    case 'cest': return p.cest ?? ''
    case 'observacoes': return p.observacoes ?? ''
    case 'status': return p.ativo ? 'Ativo' : 'Inativo'
    case 'publicado': return p.publicado ? 'Sim' : 'Não'
    default: return ''
  }
}

function renderCelula(p: Produto, chave: string): ReactNode {
  switch (chave) {
    case 'custo': return `R$ ${p.preco_custo.toFixed(2)}`
    case 'venda': return `R$ ${p.preco_venda.toFixed(2)}`
    case 'promo': return p.preco_promo ? `R$ ${p.preco_promo.toFixed(2)}` : '-'
    case 'atacado1': return p.preco_atacado1 ? `R$ ${p.preco_atacado1.toFixed(2)}` : '-'
    case 'atacado2': return p.preco_atacado2 ? `R$ ${p.preco_atacado2.toFixed(2)}` : '-'
    case 'qtdmin1': return p.qtd_min_atacado1 ? String(p.qtd_min_atacado1) : '-'
    case 'qtdmin2': return p.qtd_min_atacado2 ? String(p.qtd_min_atacado2) : '-'
    case 'estoque':
      return <span className={p.estoque <= p.estoque_minimo ? 'est-baixo' : ''}>{p.estoque} {p.unidade}</span>
    case 'estoque_min': return String(p.estoque_minimo)
    case 'estoque_max': return p.estoque_maximo != null ? String(p.estoque_maximo) : '-'
    case 'peso_liq': return p.peso_liq ? `${p.peso_liq} g` : '-'
    case 'peso_bruto': return p.peso_bruto ? `${p.peso_bruto} g` : '-'
    case 'status': return p.ativo ? 'Ativo' : 'Inativo'
    case 'publicado': return p.publicado ? 'Sim' : 'Não'
    default: {
      const v = valorColuna(p, chave)
      return v === '' || v == null ? '-' : String(v)
    }
  }
}

function EmBreveAba({ titulo }: { titulo: string }) {  return (
    <div className="aba-conteudo">
      <h4>{titulo}</h4>
      <p className="sem-resultado">Este recurso estará disponível em breve.</p>
    </div>
  )
}

interface Transacao {
  tran_no: number
  criado_em: string
  tipo: string
  categoria: string | null
  quantidade: number
  motivo: string | null
  venda_id: number | null
  venda_numero: string | null
  pedido_id: number | null
  pedido_numero: string | null
  compra_id: number | null
  cliente_fornecedor: string | null
  usuario_nome: string | null
  preco: number | null
  subtotal: number | null
}

function TransacoesProduto({ produtoId }: { produtoId: number | null }) {
  const [transacoes, setTransacoes] = useState<Transacao[]>([])
  const [carregou, setCarregou] = useState(false)
  const [mostrarCanceladas, setMostrarCanceladas] = useState(false)

  useEffect(() => {
    if (!produtoId) return
    setCarregou(false)
    const canceladas = mostrarCanceladas ? '' : `AND m.tipo != 'cancelamento'`
    getDbApi().all(
      `SELECT m.id AS tran_no, m.criado_em, m.tipo, m.categoria, m.quantidade, m.motivo, m.venda_id,
              v.numero AS venda_numero,
              u.nome AS usuario_nome,
              COALESCE(c.nome, v.tipo) AS cliente_fornecedor,
              (SELECT vi.preco_unitario FROM venda_itens vi WHERE vi.venda_id = m.venda_id AND vi.produto_id = m.produto_id LIMIT 1) AS preco,
              (SELECT vi.subtotal FROM venda_itens vi WHERE vi.venda_id = m.venda_id AND vi.produto_id = m.produto_id LIMIT 1) AS subtotal
       FROM movimentacoes m
       LEFT JOIN vendas v ON v.id = m.venda_id
       LEFT JOIN clientes c ON c.id = v.cliente_id
       LEFT JOIN usuarios u ON u.id = m.usuario_id
       WHERE m.produto_id = ? ${canceladas}
       ORDER BY m.criado_em DESC
       LIMIT 500`,
      [produtoId]
    ).then((rows) => {
      setTransacoes(rows as unknown as Transacao[])
      setCarregou(true)
    }).catch(() => setCarregou(true))
  }, [produtoId, mostrarCanceladas])

  const labelTipo = (t: Transacao) => {
    if (t.categoria) {
      const mapa: Record<string, string> = {
        compra: 'Compra',
        devolucao_cliente: 'Devolução do Cliente',
        transferencia_entrada: 'Transferência (entrada)',
        retorno_remessa: 'Retorno de Remessa',
        ajuste_entrada: 'Ajuste de Estoque +',
        outras_entradas: 'Outras Entradas',
        devolucao_fornecedor: 'Devolução ao Fornecedor',
        transferencia_saida: 'Transferência (saída)',
        uso_interno: 'Uso Interno',
        remessa_conserto: 'Remessa para Conserto',
        ajuste_saida: 'Ajuste de Estoque -',
        outras_saidas: 'Outras Saídas',
        bonificacao: 'Bonificação'
      }
      return mapa[t.categoria] || t.categoria
    }
    switch (t.tipo) {
      case 'saida': return 'Venda'
      case 'entrada': return 'Ajuste de Estoque +'
      case 'cancelamento': return 'Cancelamento'
      case 'ajuste': return 'Ajuste de Estoque -'
      default: return t.tipo
    }
  }

  const fmtDataHora = (dt: string) => {
    const d = new Date(dt)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  const exportarCSV = () => {
    const cab = ['Tran. No.', 'Data/Hora', 'Tipo', 'Vl. Unitário', 'Valor Total', 'Quantidade', 'Cliente/Fornecedor', 'Funcionário']
    const linhas = transacoes.map((t) => [
      t.tran_no, t.criado_em, labelTipo(t),
      t.preco != null ? t.preco.toFixed(2) : '',
      t.subtotal != null ? t.subtotal.toFixed(2) : '',
      t.quantidade, t.cliente_fornecedor ?? '', t.usuario_nome ?? ''
    ])
    const csv = [cab, ...linhas].map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `transacoes_produto_${produtoId}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const imprimir = () => {
    window.print()
  }

  return (
    <div className="aba-conteudo">
      <div className="transacoes-barra">
        <button className="btn-secundario" onClick={imprimir}>🖨 Imprimir</button>
        <button className="btn-secundario" onClick={exportarCSV}>⭳ Exportar</button>
        <label className="check-inline">
          <input type="checkbox" checked={mostrarCanceladas} onChange={(e) => setMostrarCanceladas(e.target.checked)} />
          Mostrar transações canceladas
        </label>
      </div>
      {!carregou ? (
        <p className="sem-resultado">Carregando...</p>
      ) : transacoes.length === 0 ? (
        <p className="sem-resultado">Nenhuma transação para este produto ainda.</p>
      ) : (
        <div className="tabela-wrap" style={{ maxHeight: 420 }}>
          <table className="tabela tabela-transacoes">
            <thead>
              <tr>
                <th>Ação</th>
                <th>Tran. No.</th>
                <th>Data/Hora</th>
                <th>Tipo de Transação</th>
                <th className="th-direita">Vl. Unitário</th>
                <th className="th-direita">Valor Total</th>
                <th className="th-centro">Quantidade</th>
                <th>Cliente / Fornecedor</th>
                <th className="th-centro">Cancelado</th>
                <th className="th-centro">Cancelado Em</th>
                <th>Funcionário</th>
              </tr>
            </thead>
            <tbody>
              {transacoes.map((t, i) => (
                <tr key={i} className={t.tipo === 'cancelamento' ? 'linha-cancelada' : ''}>
                  <td><button className="btn-mini">Abrir</button></td>
                  <td>{t.tran_no}</td>
                  <td>{fmtDataHora(t.criado_em)}</td>
                  <td className="texto-negrito">{labelTipo(t)}</td>
                  <td className="td-direita">{t.preco != null ? `R$ ${t.preco.toFixed(2)}` : 'R$ 0,00'}</td>
                  <td className="td-direita texto-negrito">{t.subtotal != null ? `R$ ${t.subtotal.toFixed(2)}` : 'R$ 0,00'}</td>
                  <td className="td-centro texto-negrito">{t.quantidade}</td>
                  <td>{t.cliente_fornecedor ?? ''}</td>
                  <td className="td-centro">{t.tipo === 'cancelamento' ? 'Sim' : 'Não'}</td>
                  <td className="td-centro">{t.tipo === 'cancelamento' ? fmtDataHora(t.criado_em) : ''}</td>
                  <td>{t.usuario_nome ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

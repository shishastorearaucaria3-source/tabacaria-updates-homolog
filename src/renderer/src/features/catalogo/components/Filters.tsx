interface Filtros {
  categoria: string
  imagem: string
  publicacao: string
  estoque: string
}

const CATEGORIAS_FILTRO = ['Todas']
const IMAGEM_FILTRO = ['Todos', 'Com imagem', 'Sem imagem']
const PUBLICACAO_FILTRO = ['Todos', 'Publicados', 'Não publicados']
const ESTOQUE_FILTRO = ['Todos', 'Com estoque', 'Sem estoque']

export default function Filters({
  categorias,
  filtros,
  onMudar,
  onAbrirFiltros
}: {
  categorias: string[]
  filtros: Filtros
  onMudar: (f: Filtros) => void
  onAbrirFiltros: () => void
}) {
  const todas = CATEGORIAS_FILTRO.concat(categorias)

  return (
    <div className="cat-filtros">
      <button className="cat-btn-funil" onClick={onAbrirFiltros} title="Filtros avançados">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 5h16l-6 7v6l-4 2v-8z" />
        </svg>
      </button>
      <div className="cat-filtro-item">
        <span>Categoria:</span>
        <select value={filtros.categoria} onChange={(e) => onMudar({ ...filtros, categoria: e.target.value })}>
          {todas.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="cat-filtro-item">
        <span>Estoque:</span>
        <select value={filtros.estoque} onChange={(e) => onMudar({ ...filtros, estoque: e.target.value })}>
          {ESTOQUE_FILTRO.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="cat-filtro-item">
        <span>Imagem:</span>
        <select value={filtros.imagem} onChange={(e) => onMudar({ ...filtros, imagem: e.target.value })}>
          {IMAGEM_FILTRO.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="cat-filtro-item">
        <span>Publicação:</span>
        <select value={filtros.publicacao} onChange={(e) => onMudar({ ...filtros, publicacao: e.target.value })}>
          {PUBLICACAO_FILTRO.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
    </div>
  )
}

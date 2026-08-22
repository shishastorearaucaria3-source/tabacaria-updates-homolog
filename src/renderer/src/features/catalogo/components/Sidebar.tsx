interface ItemSidebar {
  id: string
  label: string
  icone: string
}

const ITENS: ItemSidebar[] = [
  { id: 'vendas', label: 'Vendas', icone: 'M6 3h12l2 5v13H4V8z M4 8h16 M9 3l1 5 M15 3l-1 5 M8 13h8 M8 17h5' },
  { id: 'clientes', label: 'Clientes', icone: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2' },
  { id: 'produtos', label: 'Produtos', icone: 'M3 7 12 3l9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10' },
  { id: 'estoque', label: 'Estoque', icone: 'M4 7h16v13H4z M8 7V4h8v3 M9 12h6 M9 15h6' },
  { id: 'catalogo', label: 'Catálogo Online', icone: 'M3 4h18v16H3z M3 10h18 M8 4v16 M16 4v16' },
  { id: 'contaspagar', label: 'Contas a Pagar', icone: 'M3 6h18v13H3z M16 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M3 9h4 M17 15h4' },
  { id: 'caixa', label: 'Caixa', icone: 'M5 4h14a2 2 0 0 1 2 2v13H3V6a2 2 0 0 1 2-2z M3 9h18 M7 13h6 M7 16h4 M19 19v2' },
  { id: 'relatorios', label: 'Relatórios', icone: 'M4 4h16v16H4z M8 16v-5 M12 16V8 M16 16v-3' },
  { id: 'nfe', label: 'Nota Fiscal', icone: 'M6 2h9l5 5v15H6z M14 2v5h5 M9 12h6 M9 16h6' },
  { id: 'aplicativos', label: 'Aplicativos', icone: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z' },
  { id: 'sobre', label: 'Sobre o Nex', icone: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v5 M12 8h.01' }
]

export default function Sidebar({
  ativo,
  recolhida,
  onNavegar,
  onAlternar
}: {
  ativo: string
  recolhida: boolean
  onNavegar: (id: string) => void
  onAlternar: () => void
}) {
  return (
    <aside className={`cat-sidebar ${recolhida ? 'recolhida' : ''}`}>
      <div className="cat-sidebar-topo">
        <button className="cat-hamburguer" onClick={onAlternar} title="Recolher/expandir menu">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>
      <nav className="cat-sidebar-nav">
        {ITENS.map((item, idx) => (
          <div key={item.id}>
            {idx === 4 && <div className="cat-sidebar-divisor" />}
            <button
              className={`cat-nav-item ${ativo === item.id ? 'ativo' : ''}`}
              onClick={() => onNavegar(item.id)}
              title={recolhida ? item.label : undefined}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d={item.icone} />
              </svg>
              {!recolhida && <span>{item.label}</span>}
            </button>
          </div>
        ))}
      </nav>
    </aside>
  )
}

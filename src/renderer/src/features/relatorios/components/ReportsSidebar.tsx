interface RelatorioItem {
  id: string
  label: string
}

interface RelatorioCategoria {
  nome: string
  itens: RelatorioItem[]
}

export const CATEGORIAS_RELATORIOS: RelatorioCategoria[] = [
  {
    nome: 'Produtos',
    itens: [
      { id: 'estoque-produto-vendido', label: 'Estoque por Produto Vendido' }
    ]
  },
  {
    nome: 'Fornecedores',
    itens: [
      { id: 'fornecedor-produto', label: 'por Produto' },
      { id: 'fornecedor-vendas-analitico', label: 'Vendas Analítico' },
      { id: 'fornecedor-vendas-sintetico', label: 'por Fornecedor' },
      { id: 'fornecedor-sintetico', label: 'Vendas Sintético' }
    ]
  },
  {
    nome: 'Vendas',
    itens: [
      { id: 'vendas-meios-pagamento', label: 'Meios de Pagamento' },
      { id: 'vendas-comissao-vendedor', label: 'Comissão por Vendedor' },
      { id: 'vendas-horario-pico', label: 'Horário de Pico' },
      { id: 'vendas-categoria-produto', label: 'por Categoria e Produto' },
      { id: 'vendas-vendedor', label: 'por Vendedor' },
      { id: 'vendas-produto', label: 'por Produto' },
      { id: 'vendas-produto-marca', label: 'Por Produto Por Marca' },
      { id: 'vendas-cliente-categoria', label: 'por Cliente e Categoria' },
      { id: 'vendas-cliente-produto', label: 'por Cliente ou Produto' },
      { id: 'vendas-combo', label: 'por Combo' },
      { id: 'vendas-retencao', label: 'Vendas / Retenção' },
      { id: 'vendas-monofasicos', label: 'Produtos Monofásicos' }
    ]
  },
  {
    nome: 'Estoque',
    itens: [
      { id: 'estoque-consumo', label: 'Uso e consumo interno' },
      { id: 'estoque-movimentacao', label: 'Movimentação de Produtos' }
    ]
  },
  {
    nome: 'Caixa',
    itens: [
      { id: 'caixa-atual', label: 'Caixa Atual' },
      { id: 'caixas-anteriores', label: 'Caixas Anteriores' }
    ]
  }
]

export default function ReportsSidebar({
  selecionado,
  onSelecionar,
  aberto,
  onFechar
}: {
  selecionado: string
  onSelecionar: (id: string) => void
  aberto: boolean
  onFechar: () => void
}) {
  return (
    <>
      {aberto && <div className="rp-sidebar-overlay" onClick={onFechar} />}
      <aside className={`rp-menu ${aberto ? 'aberto' : ''}`}>
        {CATEGORIAS_RELATORIOS.map((cat) => (
          <div key={cat.nome} className="rp-menu-categoria">
            <h3>{cat.nome}</h3>
            {cat.itens.map((item) => (
              <button
                key={item.id}
                className={`rp-menu-item ${selecionado === item.id ? 'ativo' : ''}`}
                onClick={() => {
                  onSelecionar(item.id)
                  onFechar()
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </aside>
    </>
  )
}

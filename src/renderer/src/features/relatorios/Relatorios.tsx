import { useEffect, useState } from 'react'
import Header from './components/Header'
import ReportsSidebar from './components/ReportsSidebar'
import ReportsHeader from './components/ReportsHeader'
import ReportFilters, { FiltrosRelatorio } from './components/ReportFilters'
import MetricCard from './components/MetricCard'
import SalesChart from './components/SalesChart'
import ReportTable from './components/ReportTable'
import { calcularPeriodo } from './periodo'
import {
  Metrica,
  reportFilters,
  carregarMetricas,
  carregarVendasPorHora,
  carregarMeiosPagamento,
  carregarComissaoVendedor,
  carregarPorVendedor,
  carregarPorProduto,
  carregarCaixaAtual,
  carregarCaixasAnteriores,
  carregarEstoqueProdutoVendido,
  carregarFornecedorProduto,
  carregarVendasAnalitico,
  carregarVendasSintetico,
  carregarPorCategoriaProduto,
  carregarPorClienteCategoria,
  carregarPorClienteProduto,
  carregarPorMarca,
  carregarCombo,
  carregarRetencao,
  carregarMovimentacaoEstoque,
  formatarBRL
} from './data'

const TITULOS_RELATORIOS: Record<string, string> = {
  'estoque-produto-vendido': 'Estoque por Produto Vendido',
  'fornecedor-produto': 'Fornecedores por Produto',
  'fornecedor-vendas-analitico': 'Vendas Analítico',
  'fornecedor-vendas-sintetico': 'Fornecedor Vendas Sintético',
  'fornecedor-sintetico': 'Vendas Sintético',
  'vendas-meios-pagamento': 'Meios de Pagamento',
  'vendas-comissao-vendedor': 'Comissão por Vendedor',
  'vendas-horario-pico': 'Horário de Pico',
  'vendas-categoria-produto': 'Vendas por Categoria e Produto',
  'vendas-vendedor': 'Vendas por Vendedor',
  'vendas-produto': 'Vendas por Produto',
  'vendas-produto-marca': 'Vendas por Produto Por Marca',
  'vendas-cliente-categoria': 'Vendas por Cliente e Categoria',
  'vendas-cliente-produto': 'Vendas por Cliente ou Produto',
  'vendas-combo': 'Vendas por Combo',
  'vendas-retencao': 'Vendas / Retenção',
  'vendas-monofasicos': 'Produtos Monofásicos',
  'estoque-consumo': 'Uso e consumo interno',
  'estoque-movimentacao': 'Movimentação de Produtos',
  'caixa-atual': 'Caixa Atual',
  'caixas-anteriores': 'Caixas Anteriores'
}

export default function Relatorios({
  onNavegar,
  usuarioNome
}: {
  onNavegar: (tela: string) => void
  usuarioNome: string
}) {
  const [menuAberto, setMenuAberto] = useState(false)
  const [relatorio, setRelatorio] = useState('vendas-comissao-vendedor')
  const [metrica, setMetrica] = useState<Metrica>('faturamento')
  const [filtros, setFiltros] = useState<FiltrosRelatorio>({
    chave: 'ultimos_30',
    ini: '',
    fim: '',
    tipoData: reportFilters.tiposData[0],
    hora: 'Todas'
  })
  // Período Personalizado só carrega com as duas datas preenchidas.
  const personalizadoIncompleto = filtros.chave === 'personalizado' && (!filtros.ini || !filtros.fim)

  const [metrics, setMetrics] = useState({ faturamento: 0, quantidade: 0, ticket: 0, lucro: 0 })
  const [chart, setChart] = useState<Awaited<ReturnType<typeof carregarVendasPorHora>>>([])
  const [meios, setMeios] = useState<Awaited<ReturnType<typeof carregarMeiosPagamento>>>([])
  const [comissoes, setComissoes] = useState<Awaited<ReturnType<typeof carregarComissaoVendedor>>>([])
  const [vendedores, setVendedores] = useState<Awaited<ReturnType<typeof carregarPorVendedor>>>([])
  const [produtos, setProdutos] = useState<Awaited<ReturnType<typeof carregarPorProduto>>>([])
  const [caixaAtual, setCaixaAtual] = useState<Awaited<ReturnType<typeof carregarCaixaAtual>>>(null)
  const [caixasAnteriores, setCaixasAnteriores] = useState<Awaited<ReturnType<typeof carregarCaixasAnteriores>>>([])
  const [estoqueVendido, setEstoqueVendido] = useState<Awaited<ReturnType<typeof carregarEstoqueProdutoVendido>>>([])
  const [fornecedores, setFornecedores] = useState<Awaited<ReturnType<typeof carregarFornecedorProduto>>>([])
  const [vendasAnalitico, setVendasAnalitico] = useState<Awaited<ReturnType<typeof carregarVendasAnalitico>>>([])
  const [vendasSintetico, setVendasSintetico] = useState<Awaited<ReturnType<typeof carregarVendasSintetico>>>([])
  const [porCategoria, setPorCategoria] = useState<Awaited<ReturnType<typeof carregarPorCategoriaProduto>>>([])
  const [porClienteCat, setPorClienteCat] = useState<Awaited<ReturnType<typeof carregarPorClienteCategoria>>>([])
  const [porClienteProd, setPorClienteProd] = useState<Awaited<ReturnType<typeof carregarPorClienteProduto>>>([])
  const [porMarca, setPorMarca] = useState<Awaited<ReturnType<typeof carregarPorMarca>>>([])
  const [combos, setCombos] = useState<Awaited<ReturnType<typeof carregarCombo>>>([])
  const [retencao, setRetencao] = useState<Awaited<ReturnType<typeof carregarRetencao>>>([])
  const [movimentacao, setMovimentacao] = useState<Awaited<ReturnType<typeof carregarMovimentacaoEstoque>>>([])

  useEffect(() => {
    const carregar = async () => {
      // Período único calculado pelo utilitário central (horário LOCAL → UTC
      // na cláusula parametrizada). Todos os relatórios usam a mesma regra.
      if (personalizadoIncompleto) return
      const p = calcularPeriodo(filtros.chave, { ini: filtros.ini || undefined, fim: filtros.fim || undefined })
      if (relatorio === 'caixa-atual') {
        setCaixaAtual(await carregarCaixaAtual())
        return
      }
      if (relatorio === 'caixas-anteriores') {
        setCaixasAnteriores(await carregarCaixasAnteriores())
        return
      }
      if (relatorio === 'estoque-produto-vendido') {
        setEstoqueVendido(await carregarEstoqueProdutoVendido(p))
        return
      }
      if (relatorio === 'fornecedor-produto') {
        setFornecedores(await carregarFornecedorProduto())
        return
      }
      if (relatorio === 'fornecedor-vendas-analitico') {
        setVendasAnalitico(await carregarVendasAnalitico(p))
        return
      }
      if (relatorio === 'fornecedor-vendas-sintetico' || relatorio === 'fornecedor-sintetico') {
        setVendasSintetico(await carregarVendasSintetico(p))
        return
      }
      if (relatorio === 'vendas-categoria-produto') {
        setPorCategoria(await carregarPorCategoriaProduto(p))
        return
      }
      if (relatorio === 'vendas-cliente-categoria') {
        setPorClienteCat(await carregarPorClienteCategoria(p))
        return
      }
      if (relatorio === 'vendas-cliente-produto') {
        setPorClienteProd(await carregarPorClienteProduto(p))
        return
      }
      if (relatorio === 'vendas-produto-marca') {
        setPorMarca(await carregarPorMarca(p))
        return
      }
      if (relatorio === 'vendas-combo') {
        setCombos(await carregarCombo(p))
        return
      }
      if (relatorio === 'vendas-retencao') {
        setRetencao(await carregarRetencao(p))
        return
      }
      if (relatorio === 'estoque-movimentacao') {
        setMovimentacao(await carregarMovimentacaoEstoque(p))
        return
      }
      if (relatorio === 'estoque-consumo') {
        setMovimentacao(await carregarMovimentacaoEstoque(p))
        return
      }
      const [m, h, mp, cv, pv, pp] = await Promise.all([
        carregarMetricas(p),
        carregarVendasPorHora(p),
        carregarMeiosPagamento(p),
        carregarComissaoVendedor(p),
        carregarPorVendedor(p),
        carregarPorProduto(p)
      ])
      setMetrics(m)
      setChart(h)
      setMeios(mp)
      setComissoes(cv)
      setVendedores(pv)
      setProdutos(pp)
    }
    carregar()
  }, [relatorio, filtros.chave, filtros.ini, filtros.fim, filtros.tipoData, personalizadoIncompleto])

  const dadosFiltrados = filtros.hora === 'Todas' ? chart : chart.filter((d) => d.hora === filtros.hora)

  const titulo = TITULOS_RELATORIOS[relatorio] ?? 'Resumo'

  const renderResumo = () => (
    <>
      <ReportFilters filtros={filtros} onMudar={setFiltros} />
      <div className="rp-metricas">
        <MetricCard metrica="faturamento" selecionada={metrica === 'faturamento'} titulo="Faturamento" valor={metrics.faturamento} onSelecionar={setMetrica} />
        <MetricCard metrica="quantidade" selecionada={metrica === 'quantidade'} titulo="Quant. de Vendas" valor={metrics.quantidade} onSelecionar={setMetrica} />
        <MetricCard metrica="ticket" selecionada={metrica === 'ticket'} titulo="Ticket Médio" valor={metrics.ticket} onSelecionar={setMetrica} />
        <MetricCard metrica="lucro" selecionada={metrica === 'lucro'} titulo="Lucro Bruto" valor={metrics.lucro} onSelecionar={setMetrica} />
      </div>
      <SalesChart dados={dadosFiltrados} metrica={metrica} horaFiltro={filtros.hora} />
      <ReportTable dados={dadosFiltrados} metrica={metrica} horaFiltro={filtros.hora} />
    </>
  )

  const renderBarChart = (itens: { label: string; valor: number }[]) => {
    const max = Math.max(...itens.map((i) => i.valor), 1)
    return (
      <div className="rp-chart-card">
        <div className="rp-barras-horiz">
          {itens.map((i) => (
            <div key={i.label} className="rp-barra-horiz-linha">
              <span className="rp-barra-horiz-label">{i.label}</span>
              <div className="rp-barra-horiz-pista">
                <div className="rp-barra-horiz-preenchida" style={{ width: `${(i.valor / max) * 100}%` }} />
              </div>
              <span className="rp-barra-horiz-valor">{formatarBRL(i.valor)}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const renderCaixaAtual = () => {
    if (!caixaAtual) {
      return <p className="sem-resultado">Nenhum caixa aberto no momento.</p>
    }
    const saldoFinal = caixaAtual.saldo_inicial + caixaAtual.total_vendas + caixaAtual.total_suprimentos - caixaAtual.total_sangrias
    return (
      <div className="rp-tabela-card">
        <div className="rp-metricas">
          <MetricCard metrica="faturamento" selecionada={false} titulo="Saldo inicial" valor={caixaAtual.saldo_inicial} onSelecionar={() => {}} />
          <MetricCard metrica="quantidade" selecionada={false} titulo="Qtd. de vendas" valor={caixaAtual.qtd_vendas} onSelecionar={() => {}} />
          <MetricCard metrica="ticket" selecionada={false} titulo="Total vendas" valor={caixaAtual.total_vendas} onSelecionar={() => {}} />
          <MetricCard metrica="lucro" selecionada={true} titulo="Saldo final" valor={saldoFinal} onSelecionar={() => {}} />
        </div>
        <h4 className="rp-caixa-info">Caixa #{caixaAtual.id} • Aberto em {caixaAtual.aberto_em} • {caixaAtual.usuario_nome ?? 'Operador'}</h4>
        {caixaAtual.formas.length > 0 && (
          <>
            <div className="rp-subtitulo">Meios de pagamento</div>
            {renderBarChart(caixaAtual.formas.map((f) => ({ label: f.forma, valor: f.valor })))}
            <table className="rp-tabela">
              <thead>
                <tr><th>Meio de pagamento</th><th>Valor</th></tr>
              </thead>
              <tbody>
                {caixaAtual.formas.map((f) => (
                  <tr key={f.forma}>
                    <td>{f.forma}</td>
                    <td>R$ {formatarBRL(f.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    )
  }

  const renderCaixasAnteriores = () => (
    <div className="rp-tabela-card">
      <table className="rp-tabela">
        <thead>
          <tr><th>Caixa</th><th>Abertura</th><th>Fechamento</th><th>Operador</th><th>Vendas</th><th>Qtd</th><th>Saldo final</th></tr>
        </thead>
        <tbody>
          {caixasAnteriores.map((c) => (
            <tr key={c.id}>
              <td>#{c.id}</td>
              <td>{c.aberto_em}</td>
              <td>{c.fechado_em ?? '-'}</td>
              <td>{c.usuario_nome ?? '-'}</td>
              <td>R$ {formatarBRL(c.total_vendas)}</td>
              <td>{c.qtd_vendas}</td>
              <td>R$ {formatarBRL(c.saldo_final)}</td>
            </tr>
          ))}
          {caixasAnteriores.length === 0 && (
            <tr><td colSpan={7} className="sem-resultado">Nenhum caixa anterior.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )

  const renderTabelaGenerica = (colunas: { titulo: string; chave: string; monetario?: boolean; moeda?: boolean }[], linhas: Record<string, string | number>[], total?: Record<string, string | number>) => (
    <div className="rp-tabela-card">
      <table className="rp-tabela">
        <thead>
          <tr>{colunas.map((c) => <th key={c.chave}>{c.titulo}</th>)}</tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={i} className={i === 0 ? 'rp-linha-destaque' : ''}>
              {colunas.map((c) => (
                <td key={c.chave}>
                  {c.monetario || c.moeda ? `R$ ${formatarBRL(Number(l[c.chave]))}` : l[c.chave]}
                </td>
              ))}
            </tr>
          ))}
          {linhas.length === 0 && (
            <tr><td colSpan={colunas.length} className="sem-resultado">Sem dados no período.</td></tr>
          )}
        </tbody>
        {total && (
          <tfoot>
            <tr>
              {colunas.map((c) => <td key={c.chave}>{c.monetario || c.moeda ? `R$ ${formatarBRL(Number(total[c.chave]))}` : total[c.chave]}</td>)}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )

  const renderEstoqueVendido = () => (
    <>
      <ReportFilters filtros={filtros} onMudar={setFiltros} />
      {renderBarChart(estoqueVendido.slice(0, 10).map((e) => ({ label: e.produto, valor: e.total_vendido })))}
      {renderTabelaGenerica(
        [
          { titulo: 'Produto', chave: 'produto' },
          { titulo: 'Vendidos', chave: 'vendidos' },
          { titulo: 'Estoque atual', chave: 'estoque_atual' },
          { titulo: 'Total vendido', chave: 'total_vendido', monetario: true },
          { titulo: 'Lucro', chave: 'lucro', monetario: true }
        ],
        estoqueVendido.map((e) => ({ produto: e.produto, vendidos: e.vendidos, estoque_atual: e.estoque_atual, total_vendido: e.total_vendido, lucro: e.lucro })),
        { produto: 'Total', vendidos: estoqueVendido.reduce((s, e) => s + e.vendidos, 0), estoque_atual: estoqueVendido.reduce((s, e) => s + e.estoque_atual, 0), total_vendido: estoqueVendido.reduce((s, e) => s + e.total_vendido, 0), lucro: estoqueVendido.reduce((s, e) => s + e.lucro, 0) }
      )}
    </>
  )

  const renderFornecedorProduto = () => (
    <>
      {renderBarChart(fornecedores.map((f) => ({ label: f.fornecedor, valor: f.valor_estoque })))}
      {renderTabelaGenerica(
        [
          { titulo: 'Fornecedor', chave: 'fornecedor' },
          { titulo: 'Produtos', chave: 'produtos' },
          { titulo: 'Valor em estoque (custo)', chave: 'valor_estoque', monetario: true },
          { titulo: 'Valor em estoque (venda)', chave: 'preco_venda_estoque', monetario: true }
        ],
        fornecedores.map((f) => ({ fornecedor: f.fornecedor, produtos: f.produtos, valor_estoque: f.valor_estoque, preco_venda_estoque: f.preco_venda_estoque })),
        { fornecedor: 'Total', produtos: fornecedores.reduce((s, f) => s + f.produtos, 0), valor_estoque: fornecedores.reduce((s, f) => s + f.valor_estoque, 0), preco_venda_estoque: fornecedores.reduce((s, f) => s + f.preco_venda_estoque, 0) }
      )}
    </>
  )

  const renderVendasAnalitico = () => (
    <>
      <ReportFilters filtros={filtros} onMudar={setFiltros} />
      {renderTabelaGenerica(
        [
          { titulo: 'Número', chave: 'numero' },
          { titulo: 'Data', chave: 'data' },
          { titulo: 'Vendedor', chave: 'vendedor' },
          { titulo: 'Cliente', chave: 'cliente' },
          { titulo: 'Itens', chave: 'itens' },
          { titulo: 'Formas', chave: 'formas' },
          { titulo: 'Total', chave: 'total', monetario: true }
        ],
        vendasAnalitico.map((v) => ({ numero: v.numero, data: v.data, vendedor: v.vendedor, cliente: v.cliente, itens: v.itens, formas: v.formas, total: v.total })),
        { numero: 'Total', data: '', vendedor: '', cliente: '', itens: vendasAnalitico.reduce((s, v) => s + v.itens, 0), formas: '', total: vendasAnalitico.reduce((s, v) => s + v.total, 0) }
      )}
    </>
  )

  const renderVendasSintetico = () => (
    <>
      <ReportFilters filtros={filtros} onMudar={setFiltros} />
      {renderBarChart(vendasSintetico.map((v) => ({ label: v.data, valor: v.faturamento })))}
      {renderTabelaGenerica(
        [
          { titulo: 'Data', chave: 'data' },
          { titulo: 'Vendas', chave: 'vendas' },
          { titulo: 'Itens', chave: 'itens' },
          { titulo: 'Faturamento', chave: 'faturamento', monetario: true },
          { titulo: 'Ticket médio', chave: 'ticket', monetario: true }
        ],
        vendasSintetico.map((v) => ({ data: v.data, vendas: v.vendas, itens: v.itens, faturamento: v.faturamento, ticket: v.ticket })),
        { data: 'Total', vendas: vendasSintetico.reduce((s, v) => s + v.vendas, 0), itens: vendasSintetico.reduce((s, v) => s + v.itens, 0), faturamento: vendasSintetico.reduce((s, v) => s + v.faturamento, 0), ticket: vendasSintetico.reduce((s, v) => s + v.ticket, 0) }
      )}
    </>
  )

  const renderCategoriaProduto = () => (
    <>
      <ReportFilters filtros={filtros} onMudar={setFiltros} />
      {renderBarChart(porCategoria.slice(0, 10).map((c) => ({ label: c.produto, valor: c.total })))}
      {renderTabelaGenerica(
        [
          { titulo: 'Categoria', chave: 'categoria' },
          { titulo: 'Produto', chave: 'produto' },
          { titulo: 'Qtd', chave: 'qtd' },
          { titulo: 'Total', chave: 'total', monetario: true },
          { titulo: 'Lucro', chave: 'lucro', monetario: true }
        ],
        porCategoria.map((c) => ({ categoria: c.categoria, produto: c.produto, qtd: c.qtd, total: c.total, lucro: c.lucro })),
        { categoria: 'Total', produto: '', qtd: porCategoria.reduce((s, c) => s + c.qtd, 0), total: porCategoria.reduce((s, c) => s + c.total, 0), lucro: porCategoria.reduce((s, c) => s + c.lucro, 0) }
      )}
    </>
  )

  const renderMeios = () => (
    <>
      <ReportFilters filtros={filtros} onMudar={setFiltros} />
      {renderBarChart(meios.map((m) => ({ label: m.forma, valor: m.valor })))}
      {renderTabelaGenerica(
        [{ titulo: 'Meio de pagamento', chave: 'forma' }, { titulo: 'Qtd', chave: 'qtd' }, { titulo: 'Valor', chave: 'valor', monetario: true }],
        meios.map((m) => ({ forma: m.forma, qtd: m.qtd, valor: m.valor })),
        { forma: 'Total', qtd: meios.reduce((s, m) => s + m.qtd, 0), valor: meios.reduce((s, m) => s + m.valor, 0) }
      )}
    </>
  )

  const renderComissao = () => (
    <>
      <ReportFilters filtros={filtros} onMudar={setFiltros} />
      <div className="rp-metricas">
        <MetricCard metrica="faturamento" selecionada={false} titulo="Faturamento" valor={metrics.faturamento} onSelecionar={() => {}} />
        <MetricCard metrica="quantidade" selecionada={false} titulo="Quant. de Vendas" valor={metrics.quantidade} onSelecionar={() => {}} />
        <MetricCard metrica="ticket" selecionada={false} titulo="Ticket Médio" valor={metrics.ticket} onSelecionar={() => {}} />
        <MetricCard metrica="lucro" selecionada={false} titulo="Lucro Bruto" valor={metrics.lucro} onSelecionar={() => {}} />
      </div>
      {renderBarChart(comissoes.map((c) => ({ label: c.vendedor, valor: c.total })))}
      {renderTabelaGenerica(
        [
          { titulo: 'Vendedor', chave: 'vendedor' },
          { titulo: 'Vendas', chave: 'vendas' },
          { titulo: 'Total', chave: 'total', monetario: true },
          { titulo: 'Comissão', chave: 'comissao', monetario: true }
        ],
        comissoes.map((c) => ({ vendedor: c.vendedor, vendas: c.vendas, total: c.total, comissao: c.comissao })),
        { vendedor: 'Total', vendas: comissoes.reduce((s, c) => s + c.vendas, 0), total: comissoes.reduce((s, c) => s + c.total, 0), comissao: comissoes.reduce((s, c) => s + c.comissao, 0) }
      )}
    </>
  )

  const renderPorVendedor = () => (
    <>
      <ReportFilters filtros={filtros} onMudar={setFiltros} />
      {renderBarChart(vendedores.map((v) => ({ label: v.vendedor, valor: v.total })))}
      {renderTabelaGenerica(
        [{ titulo: 'Vendedor', chave: 'vendedor' }, { titulo: 'Vendas', chave: 'vendas' }, { titulo: 'Total', chave: 'total', monetario: true }],
        vendedores.map((v) => ({ vendedor: v.vendedor, vendas: v.vendas, total: v.total })),
        { vendedor: 'Total', vendas: vendedores.reduce((s, v) => s + v.vendas, 0), total: vendedores.reduce((s, v) => s + v.total, 0) }
      )}
    </>
  )

  const renderPorProduto = () => (
    <>
      <ReportFilters filtros={filtros} onMudar={setFiltros} />
      {renderBarChart(produtos.slice(0, 10).map((p) => ({ label: p.produto, valor: p.total })))}
      {renderTabelaGenerica(
        [{ titulo: 'Produto', chave: 'produto' }, { titulo: 'Qtd', chave: 'qtd' }, { titulo: 'Total', chave: 'total', monetario: true }, { titulo: 'Lucro', chave: 'lucro', monetario: true }],
        produtos.map((p) => ({ produto: p.produto, qtd: p.qtd, total: p.total, lucro: p.lucro })),
        { produto: 'Total', qtd: produtos.reduce((s, p) => s + p.qtd, 0), total: produtos.reduce((s, p) => s + p.total, 0), lucro: produtos.reduce((s, p) => s + p.lucro, 0) }
      )}
    </>
  )

  const renderPorMarca = () => (
    <>
      <ReportFilters filtros={filtros} onMudar={setFiltros} />
      {renderBarChart(porMarca.slice(0, 10).map((m) => ({ label: m.marca, valor: m.total })))}
      {renderTabelaGenerica(
        [{ titulo: 'Marca', chave: 'marca' }, { titulo: 'Produto', chave: 'produto' }, { titulo: 'Qtd', chave: 'qtd' }, { titulo: 'Total', chave: 'total', monetario: true }],
        porMarca.map((m) => ({ marca: m.marca, produto: m.produto, qtd: m.qtd, total: m.total })),
        { marca: 'Total', produto: '', qtd: porMarca.reduce((s, m) => s + m.qtd, 0), total: porMarca.reduce((s, m) => s + m.total, 0) }
      )}
    </>
  )

  const renderClienteCategoria = () => (
    <>
      <ReportFilters filtros={filtros} onMudar={setFiltros} />
      {renderTabelaGenerica(
        [{ titulo: 'Cliente', chave: 'cliente' }, { titulo: 'Categoria', chave: 'categoria' }, { titulo: 'Vendas', chave: 'vendas' }, { titulo: 'Total', chave: 'total', monetario: true }],
        porClienteCat.map((c) => ({ cliente: c.cliente, categoria: c.categoria, vendas: c.vendas, total: c.total })),
        { cliente: 'Total', categoria: '', vendas: porClienteCat.reduce((s, c) => s + c.vendas, 0), total: porClienteCat.reduce((s, c) => s + c.total, 0) }
      )}
    </>
  )

  const renderClienteProduto = () => (
    <>
      <ReportFilters filtros={filtros} onMudar={setFiltros} />
      {renderTabelaGenerica(
        [{ titulo: 'Cliente', chave: 'cliente' }, { titulo: 'Produto', chave: 'produto' }, { titulo: 'Qtd', chave: 'qtd' }, { titulo: 'Total', chave: 'total', monetario: true }],
        porClienteProd.map((c) => ({ cliente: c.cliente, produto: c.produto, qtd: c.qtd, total: c.total })),
        { cliente: 'Total', produto: '', qtd: porClienteProd.reduce((s, c) => s + c.qtd, 0), total: porClienteProd.reduce((s, c) => s + c.total, 0) }
      )}
    </>
  )

  const renderCombo = () => (
    <>
      <ReportFilters filtros={filtros} onMudar={setFiltros} />
      {renderBarChart(combos.slice(0, 10).map((c) => ({ label: c.nome, valor: c.total })))}
      {renderTabelaGenerica(
        [{ titulo: 'Produto', chave: 'nome' }, { titulo: 'Vendas', chave: 'vendas' }, { titulo: 'Total', chave: 'total', monetario: true }],
        combos.map((c) => ({ nome: c.nome, vendas: c.vendas, total: c.total })),
        { nome: 'Total', vendas: combos.reduce((s, c) => s + c.vendas, 0), total: combos.reduce((s, c) => s + c.total, 0) }
      )}
    </>
  )

  const renderRetencao = () => (
    <>
      <ReportFilters filtros={filtros} onMudar={setFiltros} />
      {renderBarChart(retencao.map((r) => ({ label: r.periodo, valor: r.clientes_novos })))}
      {renderTabelaGenerica(
        [{ titulo: 'Dia', chave: 'periodo' }, { titulo: 'Clientes', chave: 'clientes_novos' }],
        retencao.map((r) => ({ periodo: r.periodo, clientes_novos: r.clientes_novos })),
        { periodo: 'Total', clientes_novos: retencao.reduce((s, r) => s + r.clientes_novos, 0) }
      )}
    </>
  )

  const renderMovimentacao = () => (
    <>
      <ReportFilters filtros={filtros} onMudar={setFiltros} />
      {renderBarChart(movimentacao.slice(0, 10).map((m) => ({ label: m.produto, valor: m.saidas })))}
      {renderTabelaGenerica(
        [{ titulo: 'Produto', chave: 'produto' }, { titulo: 'Entradas', chave: 'entradas' }, { titulo: 'Saídas', chave: 'saidas' }, { titulo: 'Saldo', chave: 'saldo' }],
        movimentacao.map((m) => ({ produto: m.produto, entradas: m.entradas, saidas: m.saidas, saldo: m.saldo })),
        { produto: 'Total', entradas: movimentacao.reduce((s, m) => s + m.entradas, 0), saidas: movimentacao.reduce((s, m) => s + m.saidas, 0), saldo: movimentacao.reduce((s, m) => s + m.saldo, 0) }
      )}
    </>
  )

  const renderConteudo = () => {
    switch (relatorio) {
      case 'vendas-comissao-vendedor':
        return renderComissao()
      case 'vendas-horario-pico':
        return renderResumo()
      case 'vendas-meios-pagamento':
        return renderMeios()
      case 'vendas-vendedor':
        return renderPorVendedor()
      case 'vendas-produto':
        return renderPorProduto()
      case 'estoque-produto-vendido':
        return renderEstoqueVendido()
      case 'fornecedor-produto':
        return renderFornecedorProduto()
      case 'fornecedor-vendas-analitico':
        return renderVendasAnalitico()
      case 'fornecedor-vendas-sintetico':
      case 'fornecedor-sintetico':
        return renderVendasSintetico()
      case 'vendas-categoria-produto':
        return renderCategoriaProduto()
      case 'vendas-produto-marca':
        return renderPorMarca()
      case 'vendas-cliente-categoria':
        return renderClienteCategoria()
      case 'vendas-cliente-produto':
        return renderClienteProduto()
      case 'vendas-combo':
        return renderCombo()
      case 'vendas-retencao':
        return renderRetencao()
      case 'estoque-consumo':
        return renderMovimentacao()
      case 'estoque-movimentacao':
        return renderMovimentacao()
      case 'caixa-atual':
        return renderCaixaAtual()
      case 'caixas-anteriores':
        return renderCaixasAnteriores()
      default:
        return (
          <>
            <ReportFilters filtros={filtros} onMudar={setFiltros} />
            <p className="sem-resultado">Relatório "{titulo}" — em breve com dados.</p>
          </>
        )
    }
  }

  return (
    <div className="rp-online">
      <div className="rp-corpo">
        <Header titulo="Relatórios" usuarioNome={usuarioNome} />

        <div className="rp-main">
          <button className="rp-menu-toggle" onClick={() => setMenuAberto(true)}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            Relatórios
          </button>
          <ReportsSidebar
            selecionado={relatorio}
            onSelecionar={setRelatorio}
            aberto={menuAberto}
            onFechar={() => setMenuAberto(false)}
          />

          <div className="rp-relatorio">
            <ReportsHeader titulo={titulo} onVoltar={() => setRelatorio('vendas-comissao-vendedor')} />
            {renderConteudo()}
          </div>
        </div>
      </div>
    </div>
  )
}

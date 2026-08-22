import { LinhaHora, Metrica, valorPorMetrica, formatarBRL } from '../data'

export default function ReportTable({
  dados,
  metrica,
  horaFiltro
}: {
  dados: LinhaHora[]
  metrica: Metrica
  horaFiltro: string
}) {
  const linhas = horaFiltro === 'Todas' ? dados : dados.filter((d) => d.hora === horaFiltro)
  const totalVendas = dados.reduce((s, d) => s + d.vendas, 0)
  const totalFaturamento = dados.reduce((s, d) => s + d.faturamento, 0)

  return (
    <div className="rp-tabela-card">
      <div className="rp-tabela-wrap">
        <table className="rp-tabela">
          <thead>
            <tr>
              <th>Hora</th>
              <th>Vendas</th>
              <th>Ticket Médio</th>
              <th>Lucro Bruto</th>
              <th>Faturamento</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((d, i) => (
              <tr key={d.hora} className={i === 0 ? 'rp-linha-destaque' : ''}>
                <td>{d.hora}</td>
                <td>{d.vendas}</td>
                <td>R$ {formatarBRL(d.ticketMedio)}</td>
                <td>R$ {formatarBRL(d.lucroBruto)}</td>
                <td>R$ {formatarBRL(d.faturamento)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td>{totalVendas}</td>
              <td>-</td>
              <td>-</td>
              <td>R$ {formatarBRL(totalFaturamento)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

import { LinhaHora, Metrica, valorPorMetrica, formatarCompacto } from '../data'

export default function SalesChart({
  dados,
  metrica,
  horaFiltro
}: {
  dados: LinhaHora[]
  metrica: Metrica
  horaFiltro: string
}) {
  const max = Math.max(...dados.map((d) => valorPorMetrica(metrica, d)), 1)
  const passos = 4

  return (
    <div className="rp-chart-card">
      <div className="rp-chart">
        <div className="rp-chart-eixo-y">
          {Array.from({ length: passos + 1 }).map((_, i) => {
            const v = (max * (passos - i)) / passos
            return <span key={i}>{formatarCompacto(v)}</span>
          })}
        </div>
        <div className="rp-chart-corpo">
          <div className="rp-chart-linhas">
            {Array.from({ length: passos + 1 }).map((_, i) => (
              <div key={i} className="rp-chart-linha" />
            ))}
          </div>
          {dados.map((d) => {
            const v = valorPorMetrica(metrica, d)
            const altura = (v / max) * 100
            const destacada = horaFiltro === 'Todas' || horaFiltro === d.hora
            return (
              <div key={d.hora} className={`rp-chart-col ${destacada ? '' : 'apagada'}`}>
                <div className="rp-chart-barra" style={{ height: `${Math.max(altura, 2)}%` }} title={`${d.hora}: ${formatarCompacto(v)}`} />
                <span className="rp-chart-hora">{d.hora}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

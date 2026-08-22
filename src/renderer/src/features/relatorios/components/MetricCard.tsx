import { Metrica, formatarBRL } from '../data'

export default function MetricCard({
  metrica,
  selecionada,
  titulo,
  valor,
  onSelecionar
}: {
  metrica: Metrica
  selecionada: boolean
  titulo: string
  valor: number
  onSelecionar: (m: Metrica) => void
}) {
  return (
    <button className={`rp-metrica ${selecionada ? 'selecionada' : ''}`} onClick={() => onSelecionar(metrica)}>
      <span className="rp-metrica-titulo">{titulo}</span>
      <strong>{formatarBRL(valor)}</strong>
    </button>
  )
}

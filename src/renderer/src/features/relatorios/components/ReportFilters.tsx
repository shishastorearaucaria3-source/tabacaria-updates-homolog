import { reportFilters } from '../data'

export interface FiltrosRelatorio {
  data: string
  tipoData: string
  hora: string
}

export default function ReportFilters({
  filtros,
  onMudar
}: {
  filtros: FiltrosRelatorio
  onMudar: (f: FiltrosRelatorio) => void
}) {
  return (
    <div className="rp-filtros">
      <button className="rp-filtro" title="Período">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" />
        </svg>
        <span>{filtros.data}</span>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
      </button>

      <div className="rp-filtro-select">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M4 6h16v13H4z M4 10h16" />
        </svg>
        <select
          value={filtros.tipoData}
          onChange={(e) => onMudar({ ...filtros, tipoData: e.target.value })}
          title="Tipo de data"
        >
          {reportFilters.tiposData.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
      </div>

      <div className="rp-filtro-select">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />
        </svg>
        <select
          value={filtros.hora}
          onChange={(e) => onMudar({ ...filtros, hora: e.target.value })}
          title="Hora"
        >
          {reportFilters.horas.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { reportFilters } from '../data'
import { ChavePeriodo } from '../periodo'

export interface FiltrosRelatorio {
  chave: ChavePeriodo
  ini: string // 'YYYY-MM-DD' — usado apenas no período Personalizado
  fim: string
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
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Fecha o dropdown ao clicar fora dele.
  useEffect(() => {
    const fora = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [])

  const labelAtual = reportFilters.datas.find((d) => d.chave === filtros.chave)?.label ?? String(filtros.chave)
  const personalizado = filtros.chave === 'personalizado'

  const escolher = (chave: ChavePeriodo): void => {
    if (chave === 'personalizado') {
      // Entra no modo personalizado — a carga dispara quando as duas datas
      // estiverem preenchidas (Relatorios.tsx guarda enquanto incompleto).
      onMudar({ ...filtros, chave })
    } else {
      onMudar({ ...filtros, chave, ini: '', fim: '' })
    }
    setAberto(false)
  }

  const mudarData = (campo: 'ini' | 'fim', valor: string): void => {
    onMudar({ ...filtros, [campo]: valor })
  }

  return (
    <div className="rp-filtros">
      <div className="rp-filtro-wrap" ref={ref} style={{ position: 'relative' }}>
        <button
          className={`rp-filtro${aberto ? ' ativo' : ''}`}
          title="Período"
          onClick={() => setAberto((a) => !a)}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" />
          </svg>
          <span>{labelAtual}</span>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
        </button>

        {aberto && (
          <div
            className="rp-filtro-menu"
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0,
              zIndex: 30,
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 10,
              boxShadow: '0 8px 24px rgba(0,0,0,.12)',
              minWidth: 190,
              padding: 6,
              maxHeight: 320,
              overflowY: 'auto'
            }}
          >
            {reportFilters.datas.map((d) => (
              <button
                key={d.chave}
                onClick={() => escolher(d.chave as ChavePeriodo)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 10px',
                  border: 'none',
                  background: d.chave === filtros.chave ? '#eef2ff' : 'transparent',
                  color: d.chave === filtros.chave ? '#4338ca' : '#111827',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontWeight: d.chave === filtros.chave ? 600 : 400,
                  fontSize: 13
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {personalizado && (
        <>
          <input
            type="date"
            className="rp-filtro rp-filtro-date"
            value={filtros.ini}
            max={filtros.fim || undefined}
            onChange={(e) => mudarData('ini', e.target.value)}
            title="Data inicial"
          />
          <span style={{ color: '#6b7280', fontSize: 13 }}>até</span>
          <input
            type="date"
            className="rp-filtro rp-filtro-date"
            value={filtros.fim}
            min={filtros.ini || undefined}
            onChange={(e) => mudarData('fim', e.target.value)}
            title="Data final"
          />
        </>
      )}

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

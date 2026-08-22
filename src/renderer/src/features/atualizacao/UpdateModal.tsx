import { useEffect, useState } from 'react'
import { getUpdateApi } from '../../shared/db'

interface EstadoUpdate {
  ativo: boolean
  atual: string
  nova?: string
  disponivel: boolean
  obrigatoria: boolean
  notas: string[]
  erro?: string
}

type Fase = 'verificando' | 'disponivel' | 'atualizando' | 'fechado' | 'sem'

export default function UpdateModal() {
  const [fase, setFase] = useState<Fase>('verificando')
  const [info, setInfo] = useState<EstadoUpdate | null>(null)

  useEffect(() => {
    let ativo = true
    getUpdateApi()
      .verificar()
      .then((r) => {
        if (!ativo) return
        if (!r.ativo) { setFase('fechado'); return }
        if (r.disponivel) { setInfo(r); setFase('disponivel') }
        else setFase('fechado')
      })
      .catch(() => { if (ativo) setFase('fechado') })
    return () => { ativo = false }
  }, [])

  if (fase === 'verificando') {
    return (
      <div className="update-overlay">
        <div className="update-card">
          <div className="update-spinner" />
          <strong>Verificando atualizações…</strong>
        </div>
      </div>
    )
  }

  if (fase === 'fechado' || fase === 'sem') return null

  if (fase === 'atualizando') {
    return (
      <div className="update-overlay">
        <div className="update-card">
          <div className="update-spinner" />
          <strong>Baixando e instalando atualização…</strong>
          <p>O sistema será fechado e reiniciado automaticamente.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="update-overlay">
      <div className="update-card">
        <h3>Nova versão disponível</h3>
        <p className="update-linhas">
          <span>Versão instalada:</span> <strong>{info?.atual}</strong>
        </p>
        <p className="update-linhas">
          <span>Nova versão:</span> <strong>{info?.nova}</strong>
        </p>
        {info?.obrigatoria && <p className="update-obrigatoria">Atualização obrigatória</p>}
        {info && info.notas.length > 0 && (
          <ul className="update-notas">
            {info.notas.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        )}
        <div className="update-acoes">
          <button className="btn-primario" onClick={() => { setFase('atualizando'); getUpdateApi().instalar() }}>
            Atualizar agora
          </button>
          {!info?.obrigatoria && <button onClick={() => setFase('fechado')}>Mais tarde</button>}
        </div>
      </div>
    </div>
  )
}
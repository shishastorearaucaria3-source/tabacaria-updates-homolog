import { useState } from 'react'

export interface FormaConfig {
  id: number
  nome: string
  tipo: string
  ativo: number
}

export default function PagamentoModal({
  formas,
  onSalvar,
  onFechar
}: {
  formas: FormaConfig[]
  onSalvar: (f: FormaConfig[]) => void
  onFechar: () => void
}) {
  const [lista, setLista] = useState<FormaConfig[]>(formas.map((f) => ({ ...f })))

  const alternar = (id: number) => {
    setLista((prev) => prev.map((f) => (f.id === id ? { ...f, ativo: f.ativo ? 0 : 1 } : f)))
  }

  const ativas = lista.filter((f) => f.ativo).length

  return (
    <div className="modal-overlay" onClick={onFechar}>
      <div className="modal modal-config-catalogo" onClick={(e) => e.stopPropagation()}>
        <h3>Instruções de Pagamento</h3>
        <p className="nota-config">
          Selecione as formas de pagamento aceitas no catálogo online ({ativas} ativa(s)).
        </p>
        <div className="config-formas">
          {lista.map((f) => (
            <button
              key={f.id}
              className={`config-forma ${f.ativo ? 'ativa' : ''}`}
              onClick={() => alternar(f.id)}
            >
              <span className="config-forma-check">{f.ativo ? '✓' : ''}</span>
              <span>{f.nome}</span>
            </button>
          ))}
          {lista.length === 0 && <p className="sem-resultado">Nenhuma forma de pagamento cadastrada.</p>}
        </div>
        <div className="modal-acoes">
          <button className="btn-secundario" onClick={onFechar}>Cancelar</button>
          <button className="btn-primario" onClick={() => onSalvar(lista)}>Salvar</button>
        </div>
      </div>
    </div>
  )
}

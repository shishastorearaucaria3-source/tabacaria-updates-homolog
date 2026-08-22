import { useState } from 'react'

export default function ConfigPdv({ onFechar }: { onFechar: () => void }) {
  const [agrupar, setAgrupar] = useState<boolean>(() => localStorage.getItem('pdv_agrupar_iguais') !== '0')
  const [permitirSemEstoque, setPermitirSemEstoque] = useState<boolean>(() => localStorage.getItem('pdv_permitir_sem_estoque') === '1')

  const toggleAgrupar = (v: boolean) => {
    setAgrupar(v)
    try { localStorage.setItem('pdv_agrupar_iguais', v ? '1' : '0') } catch { /* ignore */ }
  }

  const toggleSemEstoque = (v: boolean) => {
    setPermitirSemEstoque(v)
    try { localStorage.setItem('pdv_permitir_sem_estoque', v ? '1' : '0') } catch { /* ignore */ }
  }

  return (
    <div className="modal-overlay" onClick={onFechar}>
      <div className="modal modal-pagamento" onClick={(e) => e.stopPropagation()}>
        <h3>Configurações do PDV</h3>
        <div className="config-pdv-lista">
          <div className="config-pdv-item">
            <div className="config-pdv-info">
              <strong>Agrupar produtos iguais na venda</strong>
              <span>Quando ativo, adicionar o mesmo produto soma na quantidade. Desative para cada adição virar um item separado (negociações diferentes).</span>
            </div>
            <label className="switch">
              <input type="checkbox" checked={agrupar} onChange={(e) => toggleAgrupar(e.target.checked)} />
              <span className="slider" />
            </label>
          </div>
          <div className="config-pdv-item">
            <div className="config-pdv-info">
              <strong>Permitir venda sem estoque</strong>
              <span>Permite adicionar produtos sem estoque direto (sem aviso).</span>
            </div>
            <label className="switch">
              <input type="checkbox" checked={permitirSemEstoque} onChange={(e) => toggleSemEstoque(e.target.checked)} />
              <span className="slider" />
            </label>
          </div>
        </div>
        <div className="modal-acoes">
          <button className="btn-primario" onClick={onFechar}>Fechar</button>
        </div>
      </div>
    </div>
  )
}

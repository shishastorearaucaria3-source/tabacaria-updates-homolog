import { useEffect, useState } from 'react'
import { getDbApi } from '../../../shared/db'

export interface ConfigPedidos {
  pedidosAtivos: boolean
  aceitaEntrega: boolean
  aceitaRetirada: boolean
  taxaEntrega: number
}

interface ZonaEntrega {
  id: number
  nome: string
  preco: number
  ativo: number
}

export default function PedidosModal({
  config,
  onSalvar,
  onFechar,
  onIrZonas
}: {
  config: ConfigPedidos
  onSalvar: (c: ConfigPedidos) => void
  onFechar: () => void
  onIrZonas: () => void
}) {
  const [form, setForm] = useState<ConfigPedidos>({ ...config })
  const [taxa, setTaxa] = useState(String(config.taxaEntrega))
  const [zonas, setZonas] = useState<ZonaEntrega[]>([])

  useEffect(() => {
    const carregar = async () => {
      const rows = (await getDbApi().all(
        `SELECT id, nome, preco, ativo FROM zonas_entrega ORDER BY nome`
      )) as unknown as ZonaEntrega[]
      setZonas(rows)
    }
    carregar()
  }, [])

  const salvar = () => {
    onSalvar({ ...form, taxaEntrega: Number(taxa) || 0 })
  }

  const alternarZona = async (z: ZonaEntrega) => {
    await getDbApi().run(`UPDATE zonas_entrega SET ativo = ? WHERE id = ?`, [z.ativo ? 0 : 1, z.id])
    setZonas((prev) => prev.map((x) => (x.id === z.id ? { ...x, ativo: x.ativo ? 0 : 1 } : x)))
  }

  return (
    <div className="modal-overlay" onClick={onFechar}>
      <div className="modal modal-config-catalogo" onClick={(e) => e.stopPropagation()}>
        <h3>Pedidos pelo Catálogo</h3>
        <p className="nota-config">
          Ative ou desative o recebimento de pedidos pelo site de delivery e defina as modalidades.
        </p>

        <div className="config-item-linha">
          <div>
            <strong>Receber pedidos</strong>
            <span>Habilita o checkout no catálogo online</span>
          </div>
          <button
            className={`cat-switch ${form.pedidosAtivos ? 'ligado' : ''}`}
            role="switch"
            aria-checked={form.pedidosAtivos}
            onClick={() => setForm({ ...form, pedidosAtivos: !form.pedidosAtivos })}
          >
            <span className="cat-switch-bola" />
          </button>
        </div>

        <div className="config-item-linha">
          <div>
            <strong>Entrega</strong>
            <span>Cliente informa o endereço e paga a taxa de entrega</span>
          </div>
          <button
            className={`cat-switch ${form.aceitaEntrega ? 'ligado' : ''}`}
            role="switch"
            aria-checked={form.aceitaEntrega}
            onClick={() => setForm({ ...form, aceitaEntrega: !form.aceitaEntrega })}
          >
            <span className="cat-switch-bola" />
          </button>
        </div>

        <div className="config-item-linha">
          <div>
            <strong>Retirada na loja</strong>
            <span>Cliente retira no balcão sem taxa</span>
          </div>
          <button
            className={`cat-switch ${form.aceitaRetirada ? 'ligado' : ''}`}
            role="switch"
            aria-checked={form.aceitaRetirada}
            onClick={() => setForm({ ...form, aceitaRetirada: !form.aceitaRetirada })}
          >
            <span className="cat-switch-bola" />
          </button>
        </div>

        <label className="config-campo">
          Taxa de entrega padrão (R$)
          <input type="number" step="0.01" min="0" value={taxa} onChange={(e) => setTaxa(e.target.value)} />
        </label>

        <div className="config-item-linha">
          <div>
            <strong>Zonas de entrega</strong>
            <span>Preço por região. As zonas têm prioridade sobre a taxa padrão.</span>
          </div>
          <button className="btn-mini" onClick={onIrZonas}>Gerenciar zonas</button>
        </div>

        {zonas.length === 0 ? (
          <p className="nota-config">Nenhuma zona cadastrada ainda. Clique em "Gerenciar zonas" para desenhar no mapa.</p>
        ) : (
          <div className="config-formas">
            {zonas.map((z) => (
              <div key={z.id} className="config-zona">
                <button
                  className={`config-forma ${z.ativo ? 'ativa' : ''}`}
                  onClick={() => alternarZona(z)}
                >
                  <span className="config-forma-check">{z.ativo ? '✓' : ''}</span>
                  <span>{z.nome} — R$ {z.preco.toFixed(2)}</span>
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="modal-acoes">
          <button className="btn-secundario" onClick={onFechar}>Cancelar</button>
          <button className="btn-primario" onClick={salvar}>Salvar</button>
        </div>
      </div>
    </div>
  )
}

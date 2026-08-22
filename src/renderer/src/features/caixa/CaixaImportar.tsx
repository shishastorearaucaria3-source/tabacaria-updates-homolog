import { useState } from 'react'
import { getDbApi, getImportarApi } from '../../shared/db'

interface DadosImportacao {
  arquivo: string
  colunas: string[]
  linhas: Record<string, unknown>[]
  erro?: string
}

function norm(v: unknown): string {
  return String(v ?? '').trim()
}

function paraNumero(v: unknown): number {
  if (typeof v === 'number') return isNaN(v) ? 0 : v
  if (v == null) return 0
  const s = String(v).replace('R$', '').replace(/[^\d,.-]/g, '').trim()
  if (!s) return 0
  if (s.includes(',')) {
    return Number(s.replace(/\./g, '').replace(',', '.')) || 0
  }
  return Number(s) || 0
}

function paraDataSQL(v: unknown): string | null {
  const s = norm(v)
  if (!s) return null
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/)
  if (m) return `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}:${m[6]}`
  const m2 = s.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/)
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]} ${m2[4]}:${m2[5]}:${m2[6]}`
  return null
}

function hoje(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export default function CaixaImportar({ onConcluido }: { onConcluido?: () => void }) {
  const [dados, setDados] = useState<DadosImportacao | null>(null)
  const [mapeamento, setMapeamento] = useState<Record<string, string>>({})
  const [mensagem, setMensagem] = useState('')
  const [importando, setImportando] = useState(false)
  const [previewLinhas, setPreviewLinhas] = useState(10)

  const CAMPOS: { campo: string; label: string; chaves: string[] }[] = [
    { campo: 'numero', label: 'Número do caixa', chaves: ['número', 'numero'] },
    { campo: 'abertura', label: 'Abertura', chaves: ['abertura'] },
    { campo: 'fechamento', label: 'Fechamento', chaves: ['fechamento'] },
    { campo: 'saldo_inicial', label: 'Saldo inicial', chaves: ['saldo inicial'] },
    { campo: 'total_vendas', label: 'Total vendas', chaves: ['total'] },
    { campo: 'saldo_final', label: 'Saldo final', chaves: ['saldo final'] },
    { campo: 'usuario_abertura', label: 'Usuário abertura', chaves: ['usuário abertura', 'usuario abertura'] },
    { campo: 'usuario_fechamento', label: 'Usuário fechamento', chaves: ['usuário fechamento', 'usuario fechamento'] },
    { campo: 'suprimentos', label: 'Adicionado ($)', chaves: ['adicionado'] },
    { campo: 'sangrias', label: 'Retirado ($)', chaves: ['retirado'] },
    { campo: 'saldo_informado', label: 'Saldo informado', chaves: ['saldo informado'] },
    { campo: 'quebra', label: 'Quebra de caixa', chaves: ['quebra de caixa', 'quebra'] }
  ]

  const selecionarArquivo = async () => {
    const res = await getImportarApi().lerArquivo()
    if (!res) return
    setDados(res)
    if (res.erro) { setMensagem(res.erro); return }
    setMensagem('')
    const mapa: Record<string, string> = {}
    for (const campo of CAMPOS) {
      const col = res.colunas.find((c) => campo.chaves.some((k) => norm(c).toLowerCase() === k)) ?? ''
      mapa[campo.campo] = col
    }
    setMapeamento(mapa)
  }

  const valorLinha = (linha: Record<string, unknown>, campo: string): unknown => {
    const col = mapeamento[campo]
    return col ? linha[col] : ''
  }

  const usuarioId = async (nome: string): Promise<number | null> => {
    if (!nome) return null
    const existente = (await getDbApi().get(`SELECT id FROM usuarios WHERE nome = ?`, [nome])) as { id: number } | undefined
    if (existente) return existente.id
    const r = await getDbApi().run(`INSERT INTO usuarios (nome, login, senha_hash, perfil) VALUES (?, ?, ?, 'vendedor')`, [nome, `importado_${Date.now()}`, 'x'])
    return Number(r.lastInsertRowid)
  }

  const importar = async () => {
    if (!dados) return
    const validas = dados.linhas.filter((l) => norm(valorLinha(l, 'numero')) !== '')
    if (validas.length === 0) {
      setMensagem('Nenhuma linha com número de caixa.')
      return
    }
    if (!confirm(`Importar ${validas.length} caixa(s)?`)) return
    setImportando(true)
    const db = getDbApi()
    let importados = 0
    try {
      for (const linha of validas) {
        const numero = String(norm(valorLinha(linha, 'numero')).replace(/\D/g, ''))
        if (!numero) continue
        const id = Number(numero)
        const abertoEm = paraDataSQL(valorLinha(linha, 'abertura')) ?? hoje()
        const fechadoEm = paraDataSQL(valorLinha(linha, 'fechamento')) ?? abertoEm
        const saldoInicial = paraNumero(valorLinha(linha, 'saldo_inicial'))
        const totalVendas = paraNumero(valorLinha(linha, 'total_vendas'))
        const suprimentos = paraNumero(valorLinha(linha, 'suprimentos'))
        const sangrias = paraNumero(valorLinha(linha, 'sangrias'))
        const saldoInformado = paraNumero(valorLinha(linha, 'saldo_informado'))
        const quebra = paraNumero(valorLinha(linha, 'quebra'))
        const usuAbertura = await usuarioId(norm(valorLinha(linha, 'usuario_abertura')))
        const usuFechamento = await usuarioId(norm(valorLinha(linha, 'usuario_fechamento')))
        await db.run(
          `INSERT INTO caixas (id, usuario_id, aberto, saldo_inicial, total_vendas, total_sangrias, total_suprimentos, qtd_vendas, aberto_em, fechado_em, usuario_fechamento, saldo_informado, quebra)
           VALUES (?, ?, 0, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             usuario_id=excluded.usuario_id, aberto=0, saldo_inicial=excluded.saldo_inicial,
             total_vendas=excluded.total_vendas, total_sangrias=excluded.total_sangrias,
             total_suprimentos=excluded.total_suprimentos, aberto_em=excluded.aberto_em,
             fechado_em=excluded.fechado_em, usuario_fechamento=excluded.usuario_fechamento,
             saldo_informado=excluded.saldo_informado, quebra=excluded.quebra`,
          [id, usuAbertura, saldoInicial, totalVendas, sangrias, suprimentos, abertoEm, fechadoEm, usuFechamento, saldoInformado || null, quebra || null]
        )
        importados++
      }
      setMensagem(`${importados} caixa(s) importado(s).`)
      setDados(null)
      onConcluido?.()
    } catch (err) {
      setMensagem(`Erro na importação: ${(err as Error).message}`)
    } finally {
      setImportando(false)
    }
  }

  if (!dados) {
    return (
      <div className="importar-vazio">
        <p>Selecione a planilha exportada do Nex com os caixas (.xlsx, .xls ou .csv).</p>
        <p className="nota-config">
          Colunas reconhecidas: Número, Abertura, Fechamento, Saldo Inicial, Total, Saldo Final,
          Usuário Abertura, Usuário Fechamento, $ Adicionado, $ Retirado, Saldo Informado, Quebra de Caixa.
        </p>
        <button className="btn-primario" onClick={selecionarArquivo}>Selecionar planilha</button>
        {mensagem && <div className="mensagem">{mensagem}</div>}
      </div>
    )
  }

  return (
    <div className="importar-painel">
      <div className="page-header">
        <div>
          <h2>Importar caixas</h2>
          <p className="nota-config">Arquivo: {dados.arquivo} • {dados.linhas.length} linhas</p>
        </div>
        <div className="page-acoes">
          <button className="btn-secundario" onClick={selecionarArquivo}>Trocar arquivo</button>
          <button className="btn-primario" onClick={importar} disabled={importando}>
            {importando ? 'Importando...' : 'Importar caixas'}
          </button>
        </div>
      </div>

      {mensagem && <div className="mensagem">{mensagem}</div>}

      <section className="rel-painel">
        <h3>Mapeamento de colunas</h3>
        <div className="mapa-grid">
          {CAMPOS.map((c) => (
            <label key={c.campo}>
              {c.label}
              <select value={mapeamento[c.campo] ?? ''} onChange={(e) => setMapeamento({ ...mapeamento, [c.campo]: e.target.value })}>
                <option value="">— ignorar —</option>
                {dados.colunas.map((col) => <option key={col} value={col}>{col}</option>)}
              </select>
            </label>
          ))}
        </div>
      </section>

      <section className="rel-painel">
        <h3>Pré-visualização</h3>
        <div className="tabela-wrap">
          <table className="tabela">
            <thead>
              <tr>
                <th>Número</th><th>Abertura</th><th>Fechamento</th><th>Saldo inicial</th><th>Total</th><th>Suprimentos</th><th>Sangrias</th>
              </tr>
            </thead>
            <tbody>
              {dados.linhas.slice(0, previewLinhas).map((l, i) => (
                <tr key={i}>
                  <td>{norm(valorLinha(l, 'numero'))}</td>
                  <td>{paraDataSQL(valorLinha(l, 'abertura')) ?? '-'}</td>
                  <td>{paraDataSQL(valorLinha(l, 'fechamento')) ?? '-'}</td>
                  <td>R$ {paraNumero(valorLinha(l, 'saldo_inicial')).toFixed(2)}</td>
                  <td>R$ {paraNumero(valorLinha(l, 'total_vendas')).toFixed(2)}</td>
                  <td>R$ {paraNumero(valorLinha(l, 'suprimentos')).toFixed(2)}</td>
                  <td>R$ {paraNumero(valorLinha(l, 'sangrias')).toFixed(2)}</td>
                </tr>
              ))}
              {dados.linhas.length === 0 && (
                <tr><td colSpan={7} className="sem-resultado">Planilha vazia.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {dados.linhas.length > previewLinhas && (
          <div className="modal-acoes">
            <button className="btn-mini" onClick={() => setPreviewLinhas((v) => v + 50)}>
              Mostrar mais ({dados.linhas.length - previewLinhas} restantes)
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

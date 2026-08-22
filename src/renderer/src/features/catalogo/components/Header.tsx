export default function Header({
  manutencao,
  onAlternarManutencao,
  usuarioNome
}: {
  manutencao: boolean
  onAlternarManutencao: () => void
  usuarioNome: string
}) {
  return (
    <header className="cat-header">
      <div className="cat-header-esq">
        <button
          className={`cat-switch ${!manutencao ? 'ligado' : ''}`}
          role="switch"
          aria-checked={!manutencao}
          onClick={onAlternarManutencao}
          title={manutencao ? 'Em manutenção — clique para reativar' : 'Site no ar — clique para ativar manutenção'}
        >
          <span className="cat-switch-bola" />
        </button>
        <h1>Catálogo Online {manutencao && <span className="cat-manutencao-badge">EM MANUTENÇÃO</span>}</h1>
      </div>
      <div className="cat-header-dir">
        <button className="cat-icone-btn" title="Menu">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
        </button>
        <button className="cat-icone-btn" title="Globo">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.5 6 3.5 9S14.5 18.5 12 21c-2.5-2.5-3.5-6-3.5-9S9.5 5.5 12 3z"/></svg>
        </button>
        <div className="cat-avatar" title={usuarioNome}>{usuarioNome.charAt(0).toUpperCase()}</div>
        <button className="cat-icone-btn" title="Configurações">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h.01a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/></svg>
        </button>
      </div>
    </header>
  )
}

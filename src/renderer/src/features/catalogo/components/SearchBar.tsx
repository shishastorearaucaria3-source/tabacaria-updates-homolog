export default function SearchBar({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  return (
    <div className="cat-pesquisa">
      <div className="cat-campo-pesquisa">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          type="text"
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Pesquisar produtos..."
        />
      </div>
    </div>
  )
}

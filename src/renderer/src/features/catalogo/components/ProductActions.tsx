export default function ProductActions({
  onCompartilhar,
  onAbrir
}: {
  onCompartilhar: () => void
  onAbrir: () => void
}) {
  return (
    <div className="cp-acoes">
      <button className="cp-icone" onClick={onCompartilhar} title="Compartilhar">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
          <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
        </svg>
      </button>
      <button className="cp-icone" onClick={onAbrir} title="Abrir produto">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </button>
    </div>
  )
}

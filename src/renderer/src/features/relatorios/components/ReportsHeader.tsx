export default function ReportsHeader({ titulo, onVoltar }: { titulo: string; onVoltar: () => void }) {
  return (
    <div className="rp-breadcrumb">
      <button className="rp-voltar" onClick={onVoltar}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        <span>{titulo}</span>
      </button>
    </div>
  )
}

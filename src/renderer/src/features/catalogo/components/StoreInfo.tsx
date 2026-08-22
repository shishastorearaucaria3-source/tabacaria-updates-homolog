export default function StoreInfo({ nomeLoja, subdominio }: { nomeLoja: string; subdominio: string }) {
  return (
    <div className="rp-loja">
      <div className="rp-logo">
        {nomeLoja.charAt(0).toUpperCase()}
      </div>
      <span className="rp-url">meucomercio.com.br/</span>
      <strong className="rp-subdominio">{subdominio}</strong>
    </div>
  )
}

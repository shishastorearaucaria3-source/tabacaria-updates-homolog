import ProductRow, { CatalogoProduto } from './ProductRow'

export default function ProductTable({
  produtos,
  editandoId,
  onAlternarPublicacao,
  onSalvarDescricao,
  onEditarDescricao,
  onCompartilhar,
  onAbrir
}: {
  produtos: CatalogoProduto[]
  editandoId: number | null
  onAlternarPublicacao: (p: CatalogoProduto) => void
  onSalvarDescricao: (p: CatalogoProduto, texto: string) => void
  onEditarDescricao: (p: CatalogoProduto) => void
  onCompartilhar: (p: CatalogoProduto) => void
  onAbrir: (p: CatalogoProduto) => void
}) {
  return (
    <div className="cp-tabela">
      <div className="cp-cabecalho">
        <span className="cp-th-publicar">Publicar</span>
        <span className="cp-th-imagem">Imagem</span>
        <span className="cp-th-produto">Produto</span>
        <span className="cp-th-descricao">Descrição</span>
        <span className="cp-th-acoes"></span>
      </div>
      <div className="cp-lista">
        {produtos.map((p) => (
          <ProductRow
            key={p.id}
            produto={p}
            editandoDescricao={editandoId === p.id}
            onAlternarPublicacao={onAlternarPublicacao}
            onSalvarDescricao={onSalvarDescricao}
            onEditarDescricao={onEditarDescricao}
            onCompartilhar={onCompartilhar}
            onAbrir={onAbrir}
          />
        ))}
        {produtos.length === 0 && (
          <div className="cp-vazio">Nenhum produto encontrado.</div>
        )}
      </div>
    </div>
  )
}

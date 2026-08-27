export interface ProductPrice {
  price: number;
  promotional_price: number | null;
}

const pricingStrategies: Record<string, (product: ProductPrice) => number | null> = {
  normal: (product) => product.price,
  promocional: (product) => (product.promotional_price != null ? product.promotional_price : null),
};

let activeStrategy = 'promocional';

export function setStrategy(name: string): void {
  if (pricingStrategies[name]) activeStrategy = name;
}

export function effectivePrice(product: ProductPrice): number {
  const promo = pricingStrategies.promocional(product);
  if (activeStrategy === 'promocional' && promo != null) return promo;
  return pricingStrategies.normal(product) ?? product.price;
}

export function priceLabel(value: number): string {
  return `R$ ${Number(value || 0).toFixed(2).replace('.', ',')}`;
}

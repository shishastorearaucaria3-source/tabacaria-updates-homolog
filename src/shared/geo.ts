export interface Ponto {
  lat: number
  lng: number
}

export interface Zona {
  id: number
  nome: string
  preco: number
  poligono: string
  ativo: number
}

export function pontoEmPoligono(ponto: Ponto, poligono: Ponto[]): boolean {
  let dentro = false
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const xi = poligono[i].lat
    const yi = poligono[i].lng
    const xj = poligono[j].lat
    const yj = poligono[j].lng
    const cruza = yi > ponto.lng !== yj > ponto.lng && ponto.lat < ((xj - xi) * (ponto.lng - yi)) / (yj - yi) + xi
    if (cruza) dentro = !dentro
  }
  return dentro
}

export function encontrarZona(ponto: Ponto, zonas: Zona[]): Zona | null {
  for (const z of zonas) {
    if (!z.ativo) continue
    try {
      const poly = JSON.parse(z.poligono) as Ponto[]
      if (pontoEmPoligono(ponto, poly)) return z
    } catch {
      continue
    }
  }
  return null
}

export function zonaParaPonto(ponto: Ponto, zonas: Zona[]): Zona | null {
  return encontrarZona(ponto, zonas)
}
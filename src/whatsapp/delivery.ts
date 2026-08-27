import type { DatabaseSync } from 'node:sqlite';
import { getSetting, getDeliveryZones } from './repo.js';

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function pointInPolygon(lat: number, lng: number, points: Array<{ lat: number; lng: number }>): boolean {
  if (!Array.isArray(points) || points.length < 3) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = Number(points[i].lat), yi = Number(points[i].lng);
    const xj = Number(points[j].lat), yj = Number(points[j].lng);
    const intersect = yi > lng !== yj > lng && lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function parseTiers(raw: string): Array<{ maxKm: number; fee: number }> {
  try {
    return JSON.parse(raw || '[]')
      .map((t: { maxKm: unknown; fee: unknown }) => ({ maxKm: Number(t.maxKm), fee: Number(t.fee) }))
      .filter((t: { maxKm: number; fee: number }) => Number.isFinite(t.maxKm) && Number.isFinite(t.fee))
      .sort((a: { maxKm: number }, b: { maxKm: number }) => a.maxKm - b.maxKm);
  } catch { return []; }
}

export interface DeliveryResult {
  determined: boolean;
  fee: number | null;
  reason?: string;
  zone?: string | null;
  distanceKm?: number | null;
  freeShipping?: boolean;
  freeAbove?: number | null;
  minOrder?: number;
  belowMinOrder?: boolean;
}

export function calculateDelivery(db: DatabaseSync, opts: { subtotal: number; lat?: number; lng?: number }): DeliveryResult {
  const { subtotal, lat, lng } = opts;
  const mode = getSetting(db, 'delivery_mode', 'fixed');
  const fixedFee = Number(getSetting(db, 'fixed_fee', '0')) || 0;
  const globalFreeAbove = Number(getSetting(db, 'free_above', '')) || null;
  const globalMinOrder = Number(getSetting(db, 'min_order', '0')) || 0;

  let baseFee: number | null = null;
  let zoneName: string | null = null;
  let distanceKm: number | null = null;
  let effectiveFreeAbove = globalFreeAbove;
  let effectiveMinOrder = globalMinOrder;

  if (mode === 'fixed') {
    baseFee = fixedFee;
  } else if (mode === 'distance') {
    const storeLat = Number(getSetting(db, 'store_lat', ''));
    const storeLng = Number(getSetting(db, 'store_lng', ''));
    if (!Number.isFinite(storeLat) || !Number.isFinite(storeLng) || typeof lat !== 'number' || typeof lng !== 'number') {
      return { determined: false, fee: null, zone: null, distanceKm: null, minOrder: effectiveMinOrder };
    }
    distanceKm = haversineKm(storeLat, storeLng, lat, lng);
    const tiers = parseTiers(getSetting(db, 'distance_tiers', '[]') ?? '[]');
    const tier = tiers.find((t) => distanceKm! <= t.maxKm);
    if (!tier) {
      return { determined: false, fee: null, reason: 'fora_da_area_entrega', zone: null, distanceKm, minOrder: effectiveMinOrder };
    }
    baseFee = tier.fee;
  } else if (mode === 'zone') {
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return { determined: false, fee: null, zone: null, distanceKm: null, minOrder: effectiveMinOrder };
    }
    const zones = getDeliveryZones(db, true);
    const hit = zones.find((z) => pointInPolygon(lat, lng, z.points));
    if (!hit) {
      return { determined: false, fee: null, reason: 'fora_das_areas', zone: null, distanceKm: null, minOrder: effectiveMinOrder };
    }
    baseFee = Number(hit.fee);
    zoneName = hit.name;
  } else {
    baseFee = fixedFee;
  }

  const freeShipping = effectiveFreeAbove != null && subtotal >= effectiveFreeAbove;
  const fee = freeShipping ? 0 : baseFee;
  return {
    determined: true,
    fee,
    zone: zoneName,
    distanceKm,
    freeShipping,
    freeAbove: effectiveFreeAbove,
    minOrder: effectiveMinOrder,
    belowMinOrder: subtotal < effectiveMinOrder,
  };
}

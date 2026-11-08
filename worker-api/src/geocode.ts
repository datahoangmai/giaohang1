import type { Env } from './env';

export interface GeocodeResult {
  lat: number | null;
  lng: number | null;
  status: 'ok' | 'low_confidence' | 'failed';
  provider: string;
}

function inVietnam(lat: number, lng: number) {
  return lat >= 8 && lat <= 24 && lng >= 102 && lng <= 110;
}

function distKm(a: [number, number], b: [number, number]) {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** Chuẩn hóa nhẹ địa chỉ trước khi gửi nhà cung cấp geocode */
export function normalizeAddress(addr: string): string {
  let s = addr.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
  if (!/vi[eệ]t\s*nam/i.test(s)) s += ', Việt Nam';
  return s;
}

export async function geocode(env: Env, address: string, hub?: { lat: number; lng: number }): Promise<GeocodeResult> {
  const provider = (env.GEOCODE_PROVIDER || 'none').toLowerCase();
  const key = env.GEOCODE_API_KEY;
  const q = encodeURIComponent(normalizeAddress(address));
  if (!address.trim() || provider === 'none' || !key) {
    return { lat: null, lng: null, status: 'failed', provider: 'none' };
  }

  try {
    let lat: number | null = null;
    let lng: number | null = null;
    let precise = false;

    if (provider === 'goong') {
      const r = await fetch(`https://rsapi.goong.io/geocode?address=${q}&api_key=${key}`);
      const d: any = await r.json();
      const loc = d?.results?.[0]?.geometry?.location;
      if (loc) {
        lat = loc.lat;
        lng = loc.lng;
        // Goong không trả độ chính xác: coi là chính xác khi địa chỉ bắt đầu bằng số nhà
        precise = /^\s*\d/.test(address);
      }
    } else if (provider === 'google') {
      const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${q}&region=vn&language=vi&key=${key}`);
      const d: any = await r.json();
      const first = d?.results?.[0];
      if (first?.geometry?.location) {
        lat = first.geometry.location.lat;
        lng = first.geometry.location.lng;
        const lt = first.geometry.location_type;
        precise = (lt === 'ROOFTOP' || lt === 'RANGE_INTERPOLATED') && !first.partial_match;
      }
    }

    if (lat === null || lng === null || !inVietnam(lat, lng)) {
      return { lat: null, lng: null, status: 'failed', provider };
    }
    let status: GeocodeResult['status'] = precise ? 'ok' : 'low_confidence';
    if (hub && distKm([hub.lat, hub.lng], [lat, lng]) > 80) status = 'low_confidence';
    return { lat, lng, status, provider };
  } catch (e) {
    console.error('geocode error', e);
    return { lat: null, lng: null, status: 'failed', provider };
  }
}

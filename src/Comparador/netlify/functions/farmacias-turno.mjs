const OFFICIAL_ENDPOINTS = [
  'https://farmanet.minsal.cl/maps/index.php/ws/getLocalesTurnos',
  'https://farmanet.minsal.cl/index.php/ws/getLocalesTurnos',
  'http://farmanet.minsal.cl/maps/index.php/ws/getLocalesTurnos',
  'http://farmanet.minsal.cl/index.php/ws/getLocalesTurnos'
];

let memoryCache = null;
const CACHE_MS = 30 * 60 * 1000;

const text = (value) => String(value ?? '').trim();
const number = (value) => {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

function normalize(item) {
  return {
    id: text(item.local_id || item.id),
    date: text(item.fecha || item.date),
    name: text(item.local_nombre || item.nombre || item.name),
    region: text(item.region_nombre || item.region || item.fk_region),
    region_id: text(item.fk_region || item.region_id),
    commune: text(item.comuna_nombre || item.comuna || item.commune),
    locality: text(item.localidad_nombre || item.localidad),
    address: text(item.local_direccion || item.direccion || item.address),
    phone: text(item.local_telefono || item.telefono || item.phone),
    latitude: number(item.local_lat || item.latitud || item.latitude || item.lat),
    longitude: number(item.local_lng || item.longitud || item.longitude || item.lng),
    opens_at: text(item.funcionamiento_hora_apertura || item.hora_apertura || item.opens_at),
    closes_at: text(item.funcionamiento_hora_cierre || item.hora_cierre || item.closes_at),
    weekday: text(item.funcionamiento_dia || item.dia || item.weekday),
    type: text(item.tipo_turno || item.tipo || 'Farmacia de turno')
  };
}

async function fetchOfficial() {
  const errors = [];
  for (const endpoint of OFFICIAL_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        headers: {Accept: 'application/json', 'User-Agent': 'FarmaAhorro/1.0'}
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const rows = Array.isArray(payload) ? payload : payload.data || payload.locales || [];
      if (!Array.isArray(rows) || !rows.length) throw new Error('Respuesta sin locales');
      return {endpoint, pharmacies: rows.map(normalize).filter(item=>item.name && item.commune)};
    } catch (error) {
      errors.push(`${endpoint}: ${error.message}`);
    }
  }
  throw new Error(errors.join(' | '));
}

export default async () => {
  const now = Date.now();
  if (memoryCache && now - memoryCache.timestamp < CACHE_MS) {
    return Response.json(memoryCache.body, {headers:{'Cache-Control':'public, max-age=300, s-maxage=1800'}});
  }
  try {
    const result = await fetchOfficial();
    const body = {
      source: 'FARMANET · Ministerio de Salud de Chile',
      source_url: result.endpoint,
      fetched_at: new Date().toISOString(),
      pharmacies: result.pharmacies
    };
    memoryCache = {timestamp: now, body};
    return Response.json(body, {headers:{'Cache-Control':'public, max-age=300, s-maxage=1800, stale-while-revalidate=86400'}});
  } catch (error) {
    if (memoryCache) return Response.json({...memoryCache.body, stale:true}, {headers:{'Cache-Control':'no-cache'}});
    return Response.json({error:'El servicio oficial de farmacias de turno no está disponible temporalmente.'}, {status:503, headers:{'Cache-Control':'no-store'}});
  }
};

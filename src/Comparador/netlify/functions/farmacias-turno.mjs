const OFFICIAL_ENDPOINTS = [
  'https://farmanet.minsal.cl/maps/index.php/ws/getLocalesTurnos',
  'https://farmanet.minsal.cl/index.php/ws/getLocalesTurnos',
  'http://farmanet.minsal.cl/maps/index.php/ws/getLocalesTurnos',
  'http://farmanet.minsal.cl/index.php/ws/getLocalesTurnos'
];

const memoryCache = new Map();
const CACHE_MS = 30 * 60 * 1000;

const text = (value) => String(value ?? '').trim();
const number = (value) => {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

function normalize(item, region='') {
  return {
    id: text(item.local_id || item.id),
    date: text(item.fecha || item.date),
    name: text(item.local_nombre || item.nombre || item.name),
    region: text(item.region_nombre || item.region || region || item.fk_region),
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
    type: text(item.tipo_turno || item.tipo || 'Farmacia de turno'),
    open_now: typeof item.open === 'boolean' ? item.open : null,
    on_duty: typeof item.turno === 'boolean' ? item.turno : true,
    schedule: text(item.horario),
    duty_schedule: text(item.turno_horario)
  };
}

async function fetchOfficial() {
  const attempts = OFFICIAL_ENDPOINTS.map(async (endpoint) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    try {
      const response = await fetch(endpoint, {
        headers: {Accept: 'application/json', 'User-Agent': 'FarmaAhorro/1.0'},
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const rows = Array.isArray(payload) ? payload : payload.data || payload.locales || [];
      if (!Array.isArray(rows) || !rows.length) throw new Error('Respuesta sin locales');
      return {endpoint, pharmacies: rows.map(normalize).filter(item=>item.name && item.commune)};
    } finally {
      clearTimeout(timeout);
    }
  });
  return Promise.any(attempts);
}

async function fetchBuscaFarma(bounds, region) {
  const url = new URL('https://buscafarma.cl/api/farmacias');
  Object.entries(bounds).forEach(([key,value])=>url.searchParams.set(key,String(value)));
  const response = await fetch(url, {headers:{Accept:'application/json','User-Agent':'FarmaAhorro/1.0'}});
  if(!response.ok) throw new Error(`BuscaFarma HTTP ${response.status}`);
  const rows = await response.json();
  if(!Array.isArray(rows)) throw new Error('Respuesta de respaldo inválida');
  return {endpoint:url.toString(),pharmacies:rows.map(item=>normalize({
    ...item,
    local_id:item.im,
    local_nombre:item.nombre,
    local_direccion:item.direccion,
    local_telefono:item.telefono,
    local_lat:item.lat,
    local_lng:item.lng,
    comuna_nombre:item.comuna
  },region)).filter(item=>item.name&&item.commune)};
}

function requestBounds(url) {
  const defaults={south:-21,north:-19.5,west:-71.5,east:-69};
  const bounds={};
  for(const [key,fallback] of Object.entries(defaults)) {
    const value=Number(url.searchParams.get(key));
    bounds[key]=Number.isFinite(value)?value:fallback;
  }
  if(bounds.south>=bounds.north||bounds.west>=bounds.east) return defaults;
  return bounds;
}

const inside=(item,bounds)=>item.latitude>=bounds.south&&item.latitude<=bounds.north&&item.longitude>=bounds.west&&item.longitude<=bounds.east;

export default async (request) => {
  const now = Date.now();
  const url=new URL(request.url); const bounds=requestBounds(url); const region=text(url.searchParams.get('region'));
  const cacheKey=`${region}|${Object.values(bounds).map(value=>value.toFixed(2)).join('|')}`;
  const cached=memoryCache.get(cacheKey);
  if (cached && now - cached.timestamp < CACHE_MS) {
    return Response.json(cached.body, {headers:{'Cache-Control':'public, max-age=300, s-maxage=1800'}});
  }
  try {
    let result; let source; let indirect=false;
    try {
      result=await fetchOfficial();
      result.pharmacies=result.pharmacies.filter(item=>inside(item,bounds));
      source='FARMANET · Ministerio de Salud de Chile';
    } catch {
      result=await fetchBuscaFarma(bounds,region);
      source='BuscaFarma · información pública consolidada'; indirect=true;
    }
    const body = {
      source,
      source_url: result.endpoint,
      fetched_at: new Date().toISOString(),
      indirect,
      pharmacies: result.pharmacies
    };
    memoryCache.set(cacheKey,{timestamp: now, body});
    return Response.json(body, {headers:{'Cache-Control':'public, max-age=300, s-maxage=1800, stale-while-revalidate=86400'}});
  } catch (error) {
    if (cached) return Response.json({...cached.body, stale:true}, {headers:{'Cache-Control':'no-cache'}});
    return Response.json({error:'El servicio oficial de farmacias de turno no está disponible temporalmente.'}, {status:503, headers:{'Cache-Control':'no-store'}});
  }
};

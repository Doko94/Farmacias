"""
ahumada_scraper.py
==================================================================
Scraper para Farmacias Ahumada (https://www.farmaciasahumada.cl)

Plataforma detectada: Salesforce Commerce Cloud (SFCC / Demandware, SFRA).
    - No expone API JSON pública tipo VTEX.
    - Pagina categorias con el endpoint AJAX interno "Search-UpdateGrid".
    - El STOCK depende de la zona (Region + Comuna) guardada en la SESION (cookie).
      Por eso el flujo es: bootstrap -> set_location(region, comuna) -> crawl.

Diseño (grado senior):
    - Capa fetching / parsing / storage separadas.
    - httpx.AsyncClient con HTTP/2, cookies persistentes y headers realistas.
    - Rate limiting (Semaphore + jitter) + reintentos con backoff exponencial.
    - Parsing defensivo con selectolax: intenta el atributo `content` (numerico
      limpio de SFRA) y cae a parseo de texto CLP si no esta.
    - Validacion con Pydantic para detectar cuando el DOM cambia y capturas basura.
    - Salida a JSONL (1 producto por linea) lista para cargar a un time-series.

Dependencias:
    pip install "httpx[http2]" selectolax pydantic truststore
    (truststore es para entornos con proxy corporativo / inspeccion SSL, ej. NTT.
     En una red domestica sin inspeccion HTTPS es opcional.)

IMPORTANTE - lo unico que debes CONFIRMAR con DevTools (Network) una vez:
    1) El endpoint exacto y los nombres de campo del selector de comuna
       ("Guardar" del modal de ubicacion). Lo dejo parametrizado en
       LocationConfig con el patron mas probable; verifica y ajusta.
    2) Que las clases CSS de los tiles (.product-tile / .product) sigan siendo
       las por defecto de SFRA. Usa `debug_dump_first_tile()` para inspeccionar.
==================================================================
"""

from __future__ import annotations

import asyncio
import argparse
import csv
import html as html_lib
import json
import random
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional

import httpx
from selectolax.parser import HTMLParser
from pydantic import BaseModel, Field, field_validator

# ------------------------------------------------------------------
# SSL en entorno corporativo (proxy con inspeccion HTTPS, ej. NTT)
# ------------------------------------------------------------------
# El firewall corporativo intercepta HTTPS y presenta su propio CA raiz.
# Ese CA ya esta confiado en el almacen de certificados de Windows, pero
# Python por defecto usa el bundle de certifi y no lo conoce -> falla con
# 'CERTIFICATE_VERIFY_FAILED'. truststore hace que Python use el almacen
# nativo del sistema operativo, resolviendo el problema sin desactivar la
# verificacion (nunca uses verify=False fuera de una prueba puntual).
#   pip install truststore
try:
    import truststore
    truststore.inject_into_ssl()
    _TRUSTSTORE_OK = True
except ImportError:
    # Si truststore no esta instalado, httpx cae al bundle de certifi.
    # En una red sin inspeccion SSL eso basta; en NTT probablemente no.
    _TRUSTSTORE_OK = False

# ------------------------------------------------------------------
# Configuracion base
# ------------------------------------------------------------------
BASE_URL = "https://www.farmaciasahumada.cl"

# Perfil confiable. El sitio aplica rate limiting con concurrencias altas y las
# categorias padre NO contienen todo el catalogo; por eso el modo seguro usa el
# recorrido completo que historicamente entrega cerca de 8.800 productos.
DEFAULT_CONCURRENCY = 4
DEFAULT_MIN_DELAY = 0.8
DEFAULT_MAX_DELAY = 2.0
DEFAULT_PAGE_SIZE = 24
MIN_PRODUCTS_PER_LOCATION = 7_000
CATEGORY_RETRY_ROUNDS = 2

# Ubicaciones habilitadas para esta ejecucion.
TARGET_LOCATIONS = {
    ("Tarapacá", "Iquique"),
    ("Arica y Parinacota", "Arica"),
    ("Antofagasta", "Antofagasta"),
}

# Endpoint AJAX de SFRA para paginar el grid de una categoria.
# La ruta del "Site" (Sites-ahumada-cl-Site) y el locale (default) se ven en
# las URLs de assets del sitio (demandware.static/Sites-ahumada-cl-Site/-/default).
SEARCH_SHOW = f"{BASE_URL}/on/demandware.store/Sites-ahumada-cl-Site/default/Search-Show"
SEARCH_UPDATEGRID = f"{BASE_URL}/on/demandware.store/Sites-ahumada-cl-Site/default/Search-UpdateGrid"

# User-Agent realista. Rotar entre varios reduce fingerprinting simple.
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
]

DEFAULT_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-CL,es;q=0.9",
    "Cache-Control": "no-cache",
    # SFRA distingue peticiones AJAX por este header en varios controladores.
    # Para UpdateGrid conviene marcarlo como XHR.
}

# ------------------------------------------------------------------
# Arbol de categorias del menu principal (extraido del sitio).
# Se deja estatico para no depender de parsear el mega-menu en cada corrida;
# igual existe discover_menu() por si quieres refrescarlo dinamicamente.
# Nota: son las URLs friendly; el crawler resuelve el cgid solo desde el boton
# "Mas Resultados" de cada pagina, asi no hay que hardcodear cgids.
# ------------------------------------------------------------------
CATEGORY_TREE: dict[str, list[str]] = {
    "dermocosmetica": [
        "dermocosmetica/marcas", "dermocosmetica/rostro", "dermocosmetica/proteccion-solar",
        "dermocosmetica/cuerpo", "dermocosmetica/capilar", "dermocosmetica/tipos-de-piel",
    ],
    "medicamentos": [
        "medicamentos/diabetes", "medicamentos/anticonceptivos-y-hormonas",
        "medicamentos/sistema-nervioso", "medicamentos/sistema-respiratorio-y-alergias",
        "medicamentos/sistema-digestivo", "medicamentos/enfermedades-especificas",
        "medicamentos/hipertension", "medicamentos/oftalmologicos",
        "medicamentos/dermatologicos", "medicamentos/dolor--fiebre-e-inflamacion",
        "medicamentos/sistema-cardiovascular", "medicamentos/colesterol-y-trigliceridos",
        "medicamentos/genitourinarios", "medicamentos/huesos-y-articulaciones",
        "medicamentos/tiroides", "medicamentos/antiparasitarios-internos",
    ],
    "infantil-y-maternidad": [
        "infantil-y-maternidad/mundo-panales", "infantil-y-maternidad/lactancia-y-alimentacion",
        "infantil-y-maternidad/higiene-infantil", "infantil-y-maternidad/cuidado-de-la-piel",
        "infantil-y-maternidad/cuidado-para-la-mama", "infantil-y-maternidad/accesorios-infantiles",
    ],
    "belleza": [
        "belleza/rostro", "belleza/cuidado-capilar", "belleza/maquillaje-y-accesorios",
        "belleza/cuerpo", "belleza/proteccion-solar", "belleza/perfumeria",
    ],
    "vitaminas-y-suplementos": [
        "vitaminas-y-suplementos/vitaminas-y-minerales",
        "vitaminas-y-suplementos/nutricion-deportiva",
        "vitaminas-y-suplementos/suplementos-alimenticios",
    ],
    "higiene-y-cuidado-personal": [
        "higiene-y-cuidado-personal/cuidado-bucal",
        "higiene-y-cuidado-personal/desodorantes-y-antitranspirantes",
        "higiene-y-cuidado-personal/cuidado-mujer", "higiene-y-cuidado-personal/higiene-personal",
        "higiene-y-cuidado-personal/cuidado-hombre", "higiene-y-cuidado-personal/electricos",
    ],
    "cuidado-adulto": [
        "cuidado-adulto/nutricion-adulto", "cuidado-adulto/dispositivos-de-medicion-",
        "cuidado-adulto/incontinencia",
    ],
    "bienestar-sexual": [
        "bienestar-sexual/preservativos", "bienestar-sexual/lubricantes",
        "bienestar-sexual/accesorios", "bienestar-sexual/anticonceptivos",
    ],
    "proteccion-y-prevencion": [
        "proteccion-y-prevencion/pruebas-test", "proteccion-y-prevencion/primeros-auxilios",
        "proteccion-y-prevencion/ortopedicos",
    ],
    "bebidas-y-alimentos": [
        "bebidas-y-alimentos/bebestibles", "bebidas-y-alimentos/confiteria",
    ],
    "mundo-mascotas": [
        "mundo-mascotas/medicamentos", "mundo-mascotas/higiene",
    ],
}


def all_category_paths(include_parents: bool = True) -> list[str]:
    """Aplana el arbol a una lista de paths de categoria para crawl masivo."""
    paths: list[str] = []
    for parent, children in CATEGORY_TREE.items():
        if include_parents:
            paths.append(parent)
        paths.extend(children)
    return paths


def category_paths(mode: str) -> list[str]:
    """Selecciona categorias evitando duplicar el catalogo innecesariamente."""
    if mode == "parents":
        # Modo rapido/diagnostico. Ahumada no incluye necesariamente todos los
        # descendientes en estas grillas, por lo que no debe publicarse como
        # catalogo completo (el control de integridad lo rechazara).
        return list(CATEGORY_TREE)
    if mode == "leaves":
        return all_category_paths(include_parents=False)
    if mode == "all":
        return all_category_paths(include_parents=True)
    raise ValueError(f"Modo de categorias no soportado: {mode}")


# ------------------------------------------------------------------
# Modelo de datos (Pydantic) — valida y normaliza cada producto
# ------------------------------------------------------------------
class Product(BaseModel):
    """Un producto capturado en un instante y una comuna dados."""
    pid: str = Field(..., description="ID numerico SFCC — clave primaria estable")
    name: str
    brand: Optional[str] = None
    url: str
    image: Optional[str] = None
    price: Optional[int] = Field(None, description="Precio actual en CLP")
    price_old: Optional[int] = Field(None, description="Precio 'antes' en CLP, si hay oferta")
    fonasa_price: Optional[int] = Field(None, description="Precio publicado para Fonasa")
    discount_pct: Optional[int] = None
    bioequivalente: bool = False
    disponible_comuna: bool = True
    stock: Optional[int] = None
    # Contexto de la captura — clave para el historial de precios
    region: Optional[str] = None
    comuna: Optional[str] = None
    category_path: Optional[str] = None
    captured_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    @field_validator("price", "price_old", "fonasa_price", "stock", mode="before")
    @classmethod
    def _clp_to_int(cls, v):
        """Normaliza '$41.590' o '41.590' a int 41590 (punto = miles en CL)."""
        if v is None or isinstance(v, int):
            return v
        digits = re.sub(r"[^\d]", "", str(v))
        return int(digits) if digits else None


# ------------------------------------------------------------------
# Config del selector de ubicacion (region/comuna)
# ------------------------------------------------------------------
@dataclass
class LocationConfig:
    """
    Parametros del POST que fija la comuna en la sesion.

    CONFIRMADO via DevTools (Copy as cURL):
        POST /on/demandware.store/Sites-ahumada-cl-Site/default/Stores-SaveZone
        content-type: application/x-www-form-urlencoded
        x-requested-with: XMLHttpRequest
        body: state=<Region>&city=<Comuna>
    Ej. real capturado: state=Antofagasta&city=Antofagasta

    OJO con los VALORES de 'state': deben coincidir EXACTO con el texto que el
    sitio envia (= el value de la opcion del modal). Para Antofagasta, region y
    comuna coinciden. Para RM confirma el string exacto (probablemente
    'Metropolitana de Santiago' o 'Region Metropolitana'): abre el modal,
    selecciona RM + tu comuna, y mira el body del request Stores-SaveZone.
    """
    endpoint: str = f"{BASE_URL}/on/demandware.store/Sites-ahumada-cl-Site/default/Stores-SaveZone"
    method: str = "POST"
    region_field: str = "state"   # confirmado
    comuna_field: str = "city"    # confirmado
    extra_fields: dict = field(default_factory=dict)


# ------------------------------------------------------------------
# Scraper
# ------------------------------------------------------------------
class AhumadaScraper:
    def __init__(
        self,
        concurrency: int = 4,
        min_delay: float = 0.8,
        max_delay: float = 2.0,
        page_size: int = 24,
        location_config: Optional[LocationConfig] = None,
    ):
        # Semaforo: limita peticiones simultaneas para ser buen ciudadano.
        self._sem = asyncio.Semaphore(concurrency)
        self._min_delay = min_delay
        self._max_delay = max_delay
        self._page_size = page_size
        self._loc_cfg = location_config or LocationConfig()
        self.region: Optional[str] = None
        self.comuna: Optional[str] = None
        self._client: Optional[httpx.AsyncClient] = None

    async def __aenter__(self) -> "AhumadaScraper":
        self._client = httpx.AsyncClient(
            http2=True,
            headers={**DEFAULT_HEADERS, "User-Agent": random.choice(USER_AGENTS)},
            timeout=httpx.Timeout(20.0),
            follow_redirects=True,
        )
        await self.bootstrap()
        return self

    async def __aexit__(self, *exc):
        if self._client:
            await self._client.aclose()

    # ---------- infra: fetch con reintentos + rate limiting ----------
    async def _get(self, url: str, *, params: dict | None = None, xhr: bool = False) -> httpx.Response:
        headers = {}
        if xhr:
            # SFRA reconoce XHR por este header en varios controladores AJAX.
            headers["X-Requested-With"] = "XMLHttpRequest"
        max_attempts = 6
        for attempt in range(1, max_attempts + 1):
            async with self._sem:
                # jitter para no golpear en cadencia perfecta (evita rate-limit trivial)
                await asyncio.sleep(random.uniform(self._min_delay, self._max_delay))
                try:
                    resp = await self._client.get(url, params=params, headers=headers)
                    if resp.status_code in (429, 500, 502, 503, 504):
                        raise httpx.HTTPStatusError("retryable", request=resp.request, response=resp)
                    resp.raise_for_status()
                    return resp
                except (httpx.HTTPError,) as e:
                    if attempt == max_attempts:
                        raise
                    # backoff exponencial con jitter
                    retry_after = 0.0
                    response = getattr(e, "response", None)
                    if response is not None:
                        try:
                            retry_after = float(response.headers.get("Retry-After", 0))
                        except (TypeError, ValueError):
                            retry_after = 0.0
                    backoff = max(retry_after, min(30.0, 2 ** (attempt - 1))) + random.uniform(0, 1)
                    await asyncio.sleep(backoff)
        raise RuntimeError("unreachable")

    # ---------- 1) bootstrap: sembrar cookies de sesion ----------
    async def bootstrap(self) -> None:
        """
        GET al home para que SFCC entregue las cookies de sesion
        (dwsid / dwanonymous). Sin esto, set_location y el stock no funcionan.
        """
        await self._get(BASE_URL)

    # ---------- 2) fijar comuna en la sesion ----------
    async def set_location(self, region: str, comuna: str) -> bool:
        """
        Fija Region + Comuna en la sesion para que el stock/precio corresponda
        a esa zona. Devuelve True si la peticion fue aceptada (200).

        CONFIRMA el endpoint/campos reales con DevTools la primera vez.
        """
        self.region, self.comuna = region, comuna
        data = {
            self._loc_cfg.region_field: region,
            self._loc_cfg.comuna_field: comuna,
            **self._loc_cfg.extra_fields,
        }
        try:
            if self._loc_cfg.method.upper() == "POST":
                resp = await self._client.post(
                    self._loc_cfg.endpoint, data=data,
                    headers={"X-Requested-With": "XMLHttpRequest"},
                )
            else:
                resp = await self._client.get(self._loc_cfg.endpoint, params=data)
            if resp.status_code != 200:
                return False
            try:
                payload = resp.json()
                return bool(payload.get("success", True))
            except (ValueError, AttributeError):
                return True
        except httpx.HTTPError:
            # No abortamos el crawl: caemos a la comuna por defecto del sitio
            # (Las Condes / RM) y lo dejamos registrado en el output.
            return False

    async def discover_locations(self) -> list[tuple[str, str]]:
        """Obtiene todas las regiones/comunas habilitadas por Ahumada."""
        resp = await self._get(BASE_URL)
        tree = HTMLParser(resp.text)
        form = tree.css_first(".change-region-form[data-options-list]")
        if not form:
            raise RuntimeError("No se encontro el selector de regiones/comunas")

        raw_options = form.attributes.get("data-options-list", "")
        try:
            regions = json.loads(html_lib.unescape(raw_options))
        except json.JSONDecodeError as exc:
            raise RuntimeError("El listado de ubicaciones cambio de formato") from exc

        locations: list[tuple[str, str]] = []
        for region in regions:
            region_name = str(region.get("name", "")).strip()
            for commune in region.get("sectorList", []):
                commune_name = str(commune.get("name", "")).strip()
                if region_name and commune_name:
                    locations.append((region_name, commune_name))

        if not locations:
            raise RuntimeError("Farmacias Ahumada no devolvio ubicaciones")
        return locations

    # ---------- 3) discovery opcional del menu en vivo ----------
    async def discover_menu(self) -> dict[str, list[str]]:
        """Reparsea el mega-menu desde el home (por si cambian categorias)."""
        resp = await self._get(BASE_URL)
        tree = HTMLParser(resp.text)
        found: dict[str, list[str]] = {}
        for a in tree.css("a[href]"):
            href = a.attributes.get("href", "")
            m = re.match(rf"{re.escape(BASE_URL)}/([a-z0-9\-]+)(?:/([a-z0-9\-]+))?/?$", href)
            if not m:
                continue
            parent, child = m.group(1), m.group(2)
            found.setdefault(parent, [])
            if child and f"{parent}/{child}" not in found[parent]:
                found[parent].append(f"{parent}/{child}")
        return found

    # ---------- 4) parsing de tiles ----------
    @staticmethod
    def _num_from_content_or_text(node) -> Optional[str]:
        """SFRA suele poner el precio limpio en el atributo content; si no, texto."""
        if node is None:
            return None
        content = node.attributes.get("content")
        if content:
            return content
        return node.text(strip=True)

    def parse_tiles(self, html: str) -> list[Product]:
        """
        Convierte el HTML de un grid (o fragmento UpdateGrid) en Products.
        Selectores por defecto de SFRA; parsing defensivo con fallbacks.
        """
        tree = HTMLParser(html)
        products: list[Product] = []

        # SFRA: cada tile suele ser div.product[data-pid] que contiene .product-tile
        tiles = tree.css("div.product[data-pid]") or tree.css("div.product-tile")

        for t in tiles:
            # --- pid ---
            pid = t.attributes.get("data-pid")

            # --- link + nombre ---
            link_node = t.css_first(".pdp-link a.link") or t.css_first("a.link")
            name = link_node.text(strip=True) if link_node else None
            url = link_node.attributes.get("href") if link_node else None
            if url and url.startswith("/"):
                url = BASE_URL + url

            # Fallback de pid desde la URL: /slug-93545.html
            if not pid and url:
                m = re.search(r"-(\d+)\.html", url)
                pid = m.group(1) if m else None

            # --- marca ---
            brand_node = t.css_first(".product-brand") or t.css_first(".tile-brand")
            brand = brand_node.text(strip=True) if brand_node else None

            # --- precios ---
            # Actual: .price .sales .value  (content="41590")
            sales = t.css_first(".price .sales .value") or t.css_first(".price .value")
            price = self._num_from_content_or_text(sales)
            # Antes: .price .strike-through .value
            strike = t.css_first(".price .strike-through .value")
            price_old = self._num_from_content_or_text(strike)

            # --- descuento ---
            disc_node = t.css_first(".badge-product, .sales-badge, .promotion")
            discount_pct = None
            if disc_node:
                dm = re.search(r"(\d{1,3})\s*%", disc_node.text())
                discount_pct = int(dm.group(1)) if dm else None

            # --- imagen ---
            img = t.css_first("img.tile-image") or t.css_first(".image-container img")
            image = None
            if img:
                image = img.attributes.get("src") or img.attributes.get("data-src")

            if not (pid and name and url):
                # tile incompleto -> probablemente cambio el DOM: saltar, no romper
                continue

            products.append(
                Product(
                    pid=pid, name=name, brand=brand, url=url, image=image,
                    price=price, price_old=price_old, discount_pct=discount_pct,
                    region=self.region, comuna=self.comuna,
                )
            )
        return products

    # ---------- enriquecimiento desde la ficha del producto ----------
    @staticmethod
    def _clp_int(value) -> Optional[int]:
        """Convierte valores CLP como '$39.990' o 39990 a entero."""
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return int(value)
        digits = re.sub(r"[^\d]", "", str(value))
        return int(digits) if digits else None

    @staticmethod
    def _walk_json(value):
        """Recorre recursivamente objetos JSON-LD."""
        if isinstance(value, dict):
            yield value
            for child in value.values():
                yield from AhumadaScraper._walk_json(child)
        elif isinstance(value, list):
            for child in value:
                yield from AhumadaScraper._walk_json(child)

    def parse_product_detail(self, html: str) -> dict[str, object]:
        """Extrae precios, bioequivalencia y disponibilidad desde una ficha PDP."""
        tree = HTMLParser(html)
        brand: Optional[str] = None
        structured_price: Optional[int] = None
        available = True

        # JSON-LD suele ser la fuente mas estable para marca y oferta vigente.
        for script in tree.css('script[type="application/ld+json"]'):
            try:
                payload = json.loads(script.text())
            except (json.JSONDecodeError, TypeError):
                continue

            for item in self._walk_json(payload):
                item_type = item.get("@type")
                types = item_type if isinstance(item_type, list) else [item_type]
                if "Product" not in types:
                    continue

                raw_brand = item.get("brand")
                if isinstance(raw_brand, dict):
                    brand = raw_brand.get("name")
                elif isinstance(raw_brand, str):
                    brand = raw_brand

                offers = item.get("offers")
                if isinstance(offers, list):
                    offers = offers[0] if offers else None
                if isinstance(offers, dict):
                    structured_price = self._clp_int(
                        offers.get("price") or offers.get("lowPrice")
                    )
                    availability = str(offers.get("availability") or "").casefold()
                    if availability:
                        available = "instock" in availability
                break

        # Respaldo para la marca cuando no viene en JSON-LD.
        if not brand:
            brand_node = (
                tree.css_first(".product-detail .product-brand")
                or tree.css_first(".product-detail .brand")
                or tree.css_first('[itemprop="brand"]')
                or tree.css_first(".product-brand")
            )
            if brand_node:
                brand = brand_node.attributes.get("content") or brand_node.text(strip=True)

        # La caja de precios visible contiene el valor actual y, si existe,
        # el precio normal tachado. Se toman solo importes dentro de esa caja
        # para no confundirlos con el precio por litro u otras recomendaciones.
        price_box = (
            tree.css_first(".product-detail .prices")
            or tree.css_first(".product-detail .price")
            or tree.css_first(".prices-add-to-cart-actions .prices")
            or tree.css_first(".prices")
        )
        visible_prices: list[int] = []
        if price_box:
            for node in price_box.css("[content]"):
                amount = self._clp_int(node.attributes.get("content"))
                if amount and amount not in visible_prices:
                    visible_prices.append(amount)
            for raw_amount in re.findall(r"\$\s*([\d.]+)", price_box.text(separator=" ")):
                amount = self._clp_int(raw_amount)
                if amount and amount not in visible_prices:
                    visible_prices.append(amount)

        page_text = tree.body.text(separator=" ", strip=True) if tree.body else tree.text()
        fonasa_candidates: list[int] = []
        fonasa_badge = (
            tree.css_first('.product-detail img[src*="badge_fonasa"]')
            or tree.css_first('img[src*="badge_fonasa"]')
        )
        if fonasa_badge and fonasa_badge.parent:
            for raw_amount in re.findall(
                r"\$\s*([\d.]+)", fonasa_badge.parent.text(separator=" ")
            ):
                amount = self._clp_int(raw_amount)
                if amount and amount not in fonasa_candidates:
                    fonasa_candidates.append(amount)
        for pattern in (
            r"\$\s*([\d.]+)[^$]{0,80}?fonasa",
            r"fonasa[^$]{0,80}?\$\s*([\d.]+)",
        ):
            for raw_amount in re.findall(pattern, page_text, flags=re.IGNORECASE):
                amount = self._clp_int(raw_amount)
                if amount and amount not in fonasa_candidates:
                    fonasa_candidates.append(amount)
        fonasa_price = min(fonasa_candidates) if fonasa_candidates else None
        commercial_prices = [value for value in visible_prices if value != fonasa_price]

        if len(commercial_prices) >= 2:
            price = min(commercial_prices)
            price_old = max(commercial_prices)
        elif commercial_prices:
            price = commercial_prices[0]
            price_old = None
        else:
            price = structured_price
            price_old = None

        return {
            "brand": brand,
            "price": price,
            "price_old": price_old,
            "fonasa_price": fonasa_price,
            "bioequivalente": bool(
                tree.css_first(".product-detail .bioequivalent-badge")
                or tree.css_first(".image-carrousel__primary-badges .bioequivalent-badge")
            ),
            "disponible_comuna": available,
        }

    async def enrich_product(self, product: Product) -> Product:
        """Completa precio real, precio normal y marca desde la ficha PDP."""
        try:
            response = await self._get(product.url)
            detail = self.parse_product_detail(response.text)
            if detail["brand"]:
                product.brand = str(detail["brand"]).strip()
            if detail["price"] is not None:
                product.price = int(detail["price"])
            product.price_old = (
                int(detail["price_old"]) if detail["price_old"] is not None else None
            )
            product.fonasa_price = (
                int(detail["fonasa_price"])
                if detail["fonasa_price"] is not None else None
            )
            product.bioequivalente = bool(detail["bioequivalente"])
            product.disponible_comuna = bool(detail["disponible_comuna"])
        except (httpx.HTTPError, ValueError) as exc:
            print(f"[WARN] No se pudo enriquecer PID {product.pid}: {exc!r}")
        return product

    async def enrich_products(self, products: list[Product]) -> list[Product]:
        """Enriquece concurrentemente todas las fichas, respetando el semaforo."""
        return list(await asyncio.gather(*(self.enrich_product(p) for p in products)))

    def _next_grid_url(self, html: str) -> Optional[str]:
        """
        Extrae la URL del boton 'Mas Resultados' (SFRA show-more).
        Ese boton trae data-url con Search-UpdateGrid?cgid=...&start=...&sz=...
        => nos evita hardcodear el cgid. Si no hay boton, no hay mas paginas.
        """
        tree = HTMLParser(html)
        btn = (
            tree.css_first(".show-more button[data-url]")
            or tree.css_first("button.more[data-url]")
            or tree.css_first("[data-url*='Search-UpdateGrid']")
        )
        if not btn:
            return None
        url = btn.attributes.get("data-url")
        if url and url.startswith("/"):
            url = BASE_URL + url
        return url

    # ---------- 5) crawl de una categoria (con paginacion) ----------
    async def crawl_category(self, category_path: str, max_pages: int = 200) -> list[Product]:
        """
        Recorre una categoria friendly (ej. 'dermocosmetica' o
        'medicamentos/diabetes/orales') paginando via Search-UpdateGrid.
        """
        all_products: list[Product] = []
        seen_pids: set[str] = set()

        # Pagina 1: la URL friendly de la categoria
        first_url = f"{BASE_URL}/{category_path}"
        resp = await self._get(first_url)
        html = resp.text

        for _ in range(max_pages):
            page_products = self.parse_tiles(html)
            new = [p for p in page_products if p.pid not in seen_pids]
            for p in new:
                p.category_path = category_path
                seen_pids.add(p.pid)
            all_products.extend(new)

            next_url = self._next_grid_url(html)
            if not next_url:
                break

            # Fuerza el tamano de pagina si el sitio lo respeta (sz)
            next_url = re.sub(r"sz=\d+", f"sz={self._page_size}", next_url)
            resp = await self._get(next_url, xhr=True)
            html = resp.text

        return all_products

    # ---------- 6) crawl masivo ----------
    async def crawl_many(self, category_paths: Iterable[str]) -> list[Product]:
        paths = list(category_paths)
        tasks = [self.crawl_category(p) for p in paths]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        out: list[Product] = []
        failed: list[tuple[str, Exception]] = []
        for path, res in zip(paths, results):
            if isinstance(res, Exception):
                print(f"[WARN] Fallo categoria {path!r}: {res!r}")
                failed.append((path, res))
            else:
                out.extend(res)

        # Cuando varias categorias parten a la vez, SFCC puede limitar la
        # sesion completa. Los reintentos se hacen secuencialmente, con una
        # pausa de recuperacion, para no repetir la misma rafaga.
        for retry_round in range(1, CATEGORY_RETRY_ROUNDS + 1):
            if not failed:
                break
            retry_paths = [path for path, _error in failed]
            failed = []
            recovery = 10 * retry_round
            print(
                f"[INFO] Reintentando {len(retry_paths)} categorias "
                f"(ronda {retry_round}/{CATEGORY_RETRY_ROUNDS}) tras {recovery}s"
            )
            await asyncio.sleep(recovery)
            for path in retry_paths:
                try:
                    out.extend(await self.crawl_category(path))
                except Exception as exc:  # se informa y se invalida la captura
                    print(f"[WARN] Reintento fallido categoria {path!r}: {exc!r}")
                    failed.append((path, exc))

        if failed:
            names = ", ".join(path for path, _error in failed)
            raise RuntimeError(
                f"Captura incompleta: {len(failed)} categorias agotaron sus "
                f"reintentos ({names})"
            )
        return out

    # ---------- debug: volcar el HTML del primer tile ----------
    async def debug_dump_first_tile(self, category_path: str = "dermocosmetica") -> None:
        """
        Imprime el HTML crudo del primer tile para verificar/ajustar selectores
        si SFRA de Ahumada usa clases custom.
        """
        resp = await self._get(f"{BASE_URL}/{category_path}")
        tree = HTMLParser(resp.text)
        tile = tree.css_first("div.product[data-pid]") or tree.css_first("div.product-tile")
        print(tile.html if tile else "No se encontro ningun tile — revisar selector.")


# ------------------------------------------------------------------
# Persistencia a CSV
# ------------------------------------------------------------------
def save_csv(products: list[Product], path: str | Path, *, append: bool = False) -> None:
    """Guarda o agrega productos a un CSV compatible con Excel."""
    path = Path(path)
    fieldnames = list(Product.model_fields)
    mode = "a" if append else "w"
    encoding = "utf-8" if append else "utf-8-sig"

    with path.open(mode, encoding=encoding, newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        if not append:
            writer.writeheader()
        writer.writerows(product.model_dump() for product in products)

    print(f"[OK] {len(products)} productos {'agregados a' if append else 'guardados en'} {path}")


def format_duration(seconds: float) -> str:
    """Devuelve una duracion legible en formato HH:MM:SS."""
    total_seconds = max(0, round(seconds))
    hours, remainder = divmod(total_seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


# ------------------------------------------------------------------
# Demo / entrypoint
# ------------------------------------------------------------------
async def run_scraping(args: argparse.Namespace):
    # Aviso de SSL: si estas en la red de NTT y esto sale False, instala
    # truststore (pip install truststore) o el error SSL volvera.
    print(f"[INFO] truststore activo (usa CA de Windows): {_TRUSTSTORE_OK}")

    print(
        "[INFO] Perfil de rendimiento: "
        f"concurrencia={args.concurrency}, demora={args.min_delay:.2f}-"
        f"{args.max_delay:.2f}s, pagina={args.page_size}, "
        f"categorias={args.category_mode}"
    )

    async with AhumadaScraper(
        concurrency=args.concurrency,
        min_delay=args.min_delay,
        max_delay=args.max_delay,
        page_size=args.page_size,
    ) as scraper:
        available_locations = await scraper.discover_locations()
        locations = [
            location for location in available_locations
            if location in TARGET_LOCATIONS
        ]
        missing_locations = TARGET_LOCATIONS.difference(locations)
        if missing_locations:
            missing = ", ".join(
                f"{region} / {comuna}"
                for region, comuna in sorted(missing_locations)
            )
            raise RuntimeError(f"Ubicaciones no encontradas en el sitio: {missing}")

        region_count = len({region for region, _ in locations})
        print(
            f"[INFO] Ubicaciones detectadas: {region_count} regiones, "
            f"{len(locations)} comunas"
        )

        # Se escribe primero en un archivo parcial. El CSV vigente solo se
        # reemplaza cuando TODAS las ubicaciones superan los controles de
        # integridad, evitando publicar catalogos truncados.
        output_path = Path(__file__).with_name(
            "ahumada_productos.csv"
        )
        partial_path = output_path.with_name("ahumada_productos.partial.csv")
        save_csv([], partial_path)
        successful_locations = 0
        paths_to_crawl = category_paths(args.category_mode)
        print(f"[INFO] Categorias del menu a procesar: {len(paths_to_crawl)}")

        for index, (region, comuna) in enumerate(locations, start=1):
            location_started = time.perf_counter()
            print(f"[INFO] [{index}/{len(locations)}] {region} / {comuna}")
            try:
                if not await scraper.set_location(region, comuna):
                    print(f"[WARN] Ubicacion rechazada: {region} / {comuna}")
                    continue

                try:
                    captured_products = await scraper.crawl_many(paths_to_crawl)

                    # Un producto puede aparecer en categorias padre e hijas.
                    # Se conserva una fila por PID para cada region/comuna.
                    products_by_pid = {
                        product.pid: product for product in captured_products
                    }
                    productos = list(products_by_pid.values())
                    print(
                        f"[INFO] {region} / {comuna}: "
                        f"{len(captured_products)} filas capturadas, "
                        f"{len(productos)} productos unicos"
                    )
                    if len(productos) < MIN_PRODUCTS_PER_LOCATION:
                        raise RuntimeError(
                            f"Captura incompleta para {region} / {comuna}: "
                            f"{len(productos)} productos; minimo de seguridad "
                            f"{MIN_PRODUCTS_PER_LOCATION}"
                        )
                    productos = await scraper.enrich_products(productos)
                except (httpx.HTTPError, RuntimeError) as exc:
                    raise RuntimeError(
                        f"No se reemplazara el CSV por fallo en "
                        f"{region} / {comuna}: {exc}"
                    ) from exc

                save_csv(productos, partial_path, append=True)
                successful_locations += 1
            finally:
                location_elapsed = time.perf_counter() - location_started
                print(
                    f"[TIEMPO] {region} / {comuna}: "
                    f"{format_duration(location_elapsed)}"
                )

        if successful_locations != len(locations):
            raise RuntimeError(
                f"Captura incompleta: {successful_locations}/{len(locations)} "
                "ubicaciones procesadas"
            )
        partial_path.replace(output_path)
        print(f"[FIN] Catalogo validado: {successful_locations}/{len(locations)} ubicaciones -> {output_path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scraper optimizado del catalogo de Farmacias Ahumada."
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=DEFAULT_CONCURRENCY,
        help=f"Peticiones simultaneas (predeterminado: {DEFAULT_CONCURRENCY}).",
    )
    parser.add_argument(
        "--min-delay",
        type=float,
        default=DEFAULT_MIN_DELAY,
        help=f"Demora minima por solicitud (predeterminado: {DEFAULT_MIN_DELAY}).",
    )
    parser.add_argument(
        "--max-delay",
        type=float,
        default=DEFAULT_MAX_DELAY,
        help=f"Demora maxima por solicitud (predeterminado: {DEFAULT_MAX_DELAY}).",
    )
    parser.add_argument(
        "--page-size",
        type=int,
        default=DEFAULT_PAGE_SIZE,
        help=f"Productos solicitados por pagina (predeterminado: {DEFAULT_PAGE_SIZE}).",
    )
    parser.add_argument(
        "--category-mode",
        choices=("parents", "leaves", "all"),
        default="all",
        help=(
            "parents procesa las familias principales; leaves solo categorias "
            "finales; all recorre el catalogo completo y es el modo seguro "
            "predeterminado."
        ),
    )
    args = parser.parse_args()
    if args.concurrency < 1:
        parser.error("--concurrency debe ser mayor que cero")
    if args.page_size < 1:
        parser.error("--page-size debe ser mayor que cero")
    if args.min_delay < 0 or args.max_delay < 0:
        parser.error("las demoras no pueden ser negativas")
    if args.min_delay > args.max_delay:
        parser.error("--min-delay no puede superar --max-delay")
    return args


async def main(args: argparse.Namespace):
    execution_started = time.perf_counter()
    try:
        await run_scraping(args)
    finally:
        total_elapsed = time.perf_counter() - execution_started
        print(f"[TIEMPO TOTAL] {format_duration(total_elapsed)}")


if __name__ == "__main__":
    asyncio.run(main(parse_args()))

"""Exporta a CSV el catalogo de Salcobrand para comunas seleccionadas.

# El sitio usa Algolia para el catalogo. La disponibilidad comunal se calcula
# con ``available_communes`` (el mismo dato consumido por salcobrand.cl).

Dependencias:
    pip install httpx truststore
"""

from __future__ import annotations

import csv
import json
import random
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import httpx

try:
    import truststore

    truststore.inject_into_ssl()
except ImportError:
    pass


SITE_URL = "https://salcobrand.cl"
API_URL = f"{SITE_URL}/api/v1"
ALGOLIA_APP_ID = "GM3RP06HJG"
ALGOLIA_SEARCH_KEY = "0259fe250b3be4b1326eb85e47aa7d81"
ALGOLIA_INDEX = "sb_variant_production"
ALGOLIA_URL = (
    f"https://{ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/"
    f"{ALGOLIA_INDEX}/query"
)
OUTPUT_FILE = Path(__file__).with_name(
    "salcobrand_productos.csv"
)

# El ID se valida al iniciar contra el catalogo publico de comunas de Salcobrand.
TARGET_LOCATIONS = (
    {"region": "Tarapaca", "comuna": "Iquique", "state_id": 59},
    {"region": "Arica y Parinacota", "comuna": "Arica", "state_id": 55},
    {"region": "Antofagasta", "comuna": "Antofagasta", "state_id": 66},
)

CSV_FIELDS = (
    "sku",
    "nombre",
    "marca",
    "precio_normal",
    "precio_internet",
    "precio_sbpay",
    "descuento_internet_pct",
    "url",
    "imagen",
    "categoria_1",
    "categoria_2",
    "categoria_3",
    "tipo_venta",
    "requiere_receta",
    "retiro_tienda",
    "despacho_domicilio",
    "stock_global",
    "disponible_comuna",
    "region",
    "comuna",
    "capturado_en",
)


class SalcobrandScraper:
    def __init__(self, page_size: int = 1000, max_retries: int = 5) -> None:
        self.page_size = page_size
        self.max_retries = max_retries
        self.client = httpx.Client(
            timeout=httpx.Timeout(45.0),
            follow_redirects=True,
            headers={
                "Accept": "application/json",
                "Accept-Language": "es-CL,es;q=0.9",
                "Origin": SITE_URL,
                "Referer": f"{SITE_URL}/",
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/150.0.0.0 Safari/537.36"
                ),
            },
        )

    def close(self) -> None:
        self.client.close()

    def _request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        last_error: Exception | None = None
        for attempt in range(1, self.max_retries + 1):
            try:
                response = self.client.request(method, url, **kwargs)
                if response.status_code in {429, 500, 502, 503, 504}:
                    raise httpx.HTTPStatusError(
                        f"Respuesta temporal {response.status_code}",
                        request=response.request,
                        response=response,
                    )
                response.raise_for_status()
                return response
            except (httpx.HTTPError, ValueError) as exc:
                last_error = exc
                if attempt == self.max_retries:
                    break
                delay = min(20.0, (2 ** (attempt - 1)) + random.random())
                print(f"  Reintento {attempt}/{self.max_retries} en {delay:.1f}s: {exc}")
                time.sleep(delay)
        raise RuntimeError(f"No fue posible consultar {url}: {last_error}")

    def validate_locations(self) -> None:
        """Evita usar IDs obsoletos si Salcobrand cambia su catalogo."""
        response = self._request(
            "GET",
            f"{API_URL}/countries/115/states",
            params={"per_page": 1000},
        )
        states = response.json().get("states", [])
        by_id = {int(item["id"]): item["name"] for item in states}
        for location in TARGET_LOCATIONS:
            actual = by_id.get(location["state_id"])
            if normalize(actual or "") != normalize(location["comuna"]):
                raise RuntimeError(
                    "El ID de comuna cambio: "
                    f"{location['comuna']} esperaba {location['state_id']} y obtuvo {actual!r}."
                )

    def fetch_page(self, page: int) -> dict[str, Any]:
        params = urlencode(
            {
                "query": "",
                "page": page,
                "hitsPerPage": self.page_size,
                "attributesToRetrieve": "*",
            }
        )
        response = self._request(
            "POST",
            ALGOLIA_URL,
            headers={
                "x-algolia-application-id": ALGOLIA_APP_ID,
                "x-algolia-api-key": ALGOLIA_SEARCH_KEY,
                "Content-Type": "application/json",
            },
            json={"params": params},
        )
        return response.json()

    def fetch_all_products(self) -> list[dict[str, Any]]:
        products: dict[str, dict[str, Any]] = {}
        page = 0
        while True:
            payload = self.fetch_page(page)
            hits = payload.get("hits", [])
            for hit in hits:
                key = str(hit.get("sku") or hit.get("objectID") or "")
                if key:
                    products[key] = hit
            total_pages = int(payload.get("nbPages", 0))
            print(
                f"  Pagina {page + 1}/{max(total_pages, 1)} - "
                f"{len(products)} productos unicos"
            )
            page += 1
            if not hits or page >= total_pages:
                break
            time.sleep(random.uniform(0.15, 0.45))
        return list(products.values())


def normalize(value: str) -> str:
    import unicodedata

    return "".join(
        char
        for char in unicodedata.normalize("NFD", value.casefold())
        if unicodedata.category(char) != "Mn"
    ).strip()


def money(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        digits = re.sub(r"[^0-9]", "", str(value))
        return int(digits) if digits else None


def first_path(hit: dict[str, Any], level: str) -> str:
    values = hit.get("product_categories", {}).get(level, [])
    if isinstance(values, str):
        return values
    return values[0] if values else ""


def is_available(hit: dict[str, Any], state_id: int) -> bool:
    if not bool(hit.get("has_stock")):
        return False
    if not bool(hit.get("is_store_exclusive")):
        return True
    return state_id in {
        int(value) for value in (hit.get("available_communes") or [])
    }


def product_rows(products: list[dict[str, Any]]) -> list[dict[str, Any]]:
    captured_at = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    rows: list[dict[str, Any]] = []
    for hit in products:
        normal = money(hit.get("normal_price"))
        internet = money(hit.get("direct_discount")) or normal
        sbpay = money(hit.get("direct_discount_sbpay"))
        discount = None
        if normal and internet is not None and internet < normal:
            discount = round((normal - internet) * 100 / normal)
        slug = str(hit.get("slug") or "").strip("/")
        sku = str(hit.get("sku") or "")
        product_url = f"{SITE_URL}/products/{slug}"
        if sku:
            product_url += f"?default_sku={sku}"

        for location in TARGET_LOCATIONS:
            rows.append(
                {
                    "sku": sku,
                    "nombre": hit.get("name") or "",
                    "marca": hit.get("brand") or "",
                    "precio_normal": normal,
                    "precio_internet": internet,
                    "precio_sbpay": sbpay,
                    "descuento_internet_pct": discount,
                    "url": product_url,
                    "imagen": hit.get("catalog_image_url")
                    or hit.get("thumbnail_image_url")
                    or "",
                    "categoria_1": first_path(hit, "lvl0"),
                    "categoria_2": first_path(hit, "lvl1"),
                    "categoria_3": first_path(hit, "lvl2"),
                    "tipo_venta": hit.get("sale_type") or "",
                    "requiere_receta": bool(hit.get("needs_recipe")),
                    "retiro_tienda": bool(hit.get("pickup_delivery")),
                    "despacho_domicilio": bool(hit.get("package_delivery")),
                    "stock_global": bool(hit.get("has_stock")),
                    "disponible_comuna": is_available(hit, location["state_id"]),
                    "region": location["region"],
                    "comuna": location["comuna"],
                    "capturado_en": captured_at,
                }
            )
    return rows


def write_csv(rows: list[dict[str, Any]], output: Path = OUTPUT_FILE) -> None:
    temp_file = output.with_suffix(".csv.tmp")
    with temp_file.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    temp_file.replace(output)


def main() -> None:
    started = time.perf_counter()
    scraper = SalcobrandScraper()
    try:
        print("Validando Iquique, Arica y Antofagasta...")
        scraper.validate_locations()
        print("Descargando catalogo completo de Salcobrand...")
        products = scraper.fetch_all_products()
        rows = product_rows(products)
        write_csv(rows)
    finally:
        scraper.close()

    elapsed = time.perf_counter() - started
    print(f"CSV generado: {OUTPUT_FILE.resolve()}")
    print(f"Productos unicos: {len(products)} | Filas: {len(rows)}")
    print(f"Tiempo total: {elapsed:.2f} segundos ({elapsed / 60:.2f} minutos)")


if __name__ == "__main__":
    main()

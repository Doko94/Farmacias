"""Exporta el catalogo completo de Dr. Simi a CSV usando sus API VTEX."""

from __future__ import annotations

import csv
import random
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

try:
    import truststore

    truststore.inject_into_ssl()
except ImportError:
    pass


BASE_URL = "https://www.drsimi.cl"
CATALOG_ENDPOINT = "/api/catalog_system/pub/products/search"
REGIONS_ENDPOINT = "/api/checkout/pub/regions"
OUTPUT_FILE = Path(__file__).with_name(
    "drsimi_productos.csv"
)
TARGET_LOCATIONS = (
    {"region": "Tarapaca", "comuna": "Iquique", "postal_code": "1100000"},
    {"region": "Arica y Parinacota", "comuna": "Arica", "postal_code": "1000000"},
    {"region": "Antofagasta", "comuna": "Antofagasta", "postal_code": "1240000"},
)
PAGE_SIZE = 50  # Maximo admitido por Catalog Search de VTEX.
CSV_FIELDS = (
    "product_id", "sku", "referencia", "nombre", "marca",
    "precio_normal", "precio_actual", "descuento_pct", "stock_catalogo",
    "cantidad_stock_catalogo", "despacho_comuna", "retiro_comuna",
    "cobertura_vtex", "region_id_vtex", "region", "comuna", "codigo_postal",
    "categoria_1", "categoria_2", "categoria_3", "condicion_venta",
    "principio_activo", "bioequivalente", "url", "imagen", "capturado_en",
)


class DrSimiScraper:
    def __init__(self, max_retries: int = 5) -> None:
        self.max_retries = max_retries
        self.client = httpx.Client(
            base_url=BASE_URL,
            timeout=httpx.Timeout(60.0),
            follow_redirects=True,
            headers={
                "Accept": "application/json",
                "Accept-Language": "es-CL,es;q=0.9",
                "Referer": f"{BASE_URL}/",
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/150.0.0.0 Safari/537.36"
                ),
            },
        )

    def close(self) -> None:
        self.client.close()

    def request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
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
                delay = min(20.0, 2 ** (attempt - 1) + random.random())
                print(f"  Reintento {attempt}/{self.max_retries} en {delay:.1f}s: {exc}")
                time.sleep(delay)
        raise RuntimeError(f"No fue posible consultar {url}: {last_error}")

    def resolve_locations(self) -> list[dict[str, Any]]:
        locations: list[dict[str, Any]] = []
        for target in TARGET_LOCATIONS:
            response = self.request(
                "GET", REGIONS_ENDPOINT,
                params={"country": "CHL", "postalCode": target["postal_code"]},
            )
            regions = response.json()
            region = regions[0] if regions else {}
            coverage = bool(region.get("sellers") or [])
            locations.append({
                **target,
                "region_id": region.get("id") or "",
                "coverage": coverage,
            })
            status = "con cobertura" if coverage else "sin cobertura online"
            print(f"  {target['comuna']}: {status}")
        return locations

    def fetch_catalog(self) -> list[dict[str, Any]]:
        products: dict[str, dict[str, Any]] = {}
        start = 0
        total: int | None = None
        while total is None or start < total:
            response = self.request(
                "GET", CATALOG_ENDPOINT,
                params={"_from": start, "_to": start + PAGE_SIZE - 1},
            )
            batch = response.json()
            match = re.search(r"/(\d+)$", response.headers.get("resources", ""))
            if match:
                total = int(match.group(1))
            elif total is None:
                total = start + len(batch)
            for product in batch:
                product_id = str(product.get("productId") or "")
                if product_id:
                    products[product_id] = product
            print(f"  Productos {start + 1}-{start + len(batch)}/{total or '?'}")
            if not batch:
                break
            start += PAGE_SIZE
            time.sleep(random.uniform(0.12, 0.35))
        return list(products.values())


def first_value(product: dict[str, Any], key: str) -> str:
    value = product.get(key)
    if isinstance(value, list):
        return str(value[0]) if value else ""
    return str(value or "")


def category_parts(product: dict[str, Any]) -> list[str]:
    categories = product.get("categories") or []
    return [part for part in str(categories[0]).strip("/").split("/") if part] if categories else []


def best_offer(item: dict[str, Any]) -> dict[str, Any]:
    offers = []
    for seller in item.get("sellers") or []:
        offer = seller.get("commertialOffer") or {}
        if float(offer.get("Price") or 0) > 0:
            offers.append(offer)
    return min(offers, key=lambda offer: float(offer["Price"])) if offers else {}


def to_int(value: Any) -> int | None:
    try:
        return round(float(value)) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def build_rows(products: list[dict[str, Any]], locations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    captured = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    rows: list[dict[str, Any]] = []
    for product in products:
        categories = category_parts(product)
        for item in product.get("items") or []:
            offer = best_offer(item)
            normal = to_int(offer.get("ListPrice"))
            current = to_int(offer.get("Price"))
            quantity = to_int(offer.get("AvailableQuantity")) or 0
            discount = round((normal - current) * 100 / normal) if normal and current is not None and current < normal else None
            images = item.get("images") or []
            image = images[0].get("imageUrl", "") if images else ""
            reference = first_value(product, "productReference")
            if not reference:
                refs = item.get("referenceId") or []
                reference = str(refs[0].get("Value") or "") if refs else ""
            for location in locations:
                coverage = bool(location["coverage"])
                rows.append({
                    "product_id": product.get("productId") or "",
                    "sku": item.get("itemId") or "",
                    "referencia": reference,
                    "nombre": item.get("nameComplete") or item.get("name") or product.get("productName") or "",
                    "marca": product.get("brand") or "",
                    "precio_normal": normal,
                    "precio_actual": current,
                    "descuento_pct": discount,
                    "stock_catalogo": quantity > 0,
                    "cantidad_stock_catalogo": quantity,
                    "despacho_comuna": coverage and quantity > 0,
                    "retiro_comuna": coverage and quantity > 0,
                    "cobertura_vtex": coverage,
                    "region_id_vtex": location["region_id"],
                    "region": location["region"],
                    "comuna": location["comuna"],
                    "codigo_postal": location["postal_code"],
                    "categoria_1": categories[0] if len(categories) > 0 else "",
                    "categoria_2": categories[1] if len(categories) > 1 else "",
                    "categoria_3": categories[2] if len(categories) > 2 else "",
                    "condicion_venta": first_value(product, "Condición de Venta"),
                    "principio_activo": first_value(product, "Principio Activo"),
                    "bioequivalente": first_value(product, "Bioequivalente"),
                    "url": product.get("link") or f"{BASE_URL}/{product.get('linkText', '')}/p",
                    "imagen": image,
                    "capturado_en": captured,
                })
    return rows


def write_csv(rows: list[dict[str, Any]], output: Path = OUTPUT_FILE) -> None:
    temporary = output.with_suffix(".csv.tmp")
    with temporary.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    temporary.replace(output)


def main() -> None:
    started = time.perf_counter()
    scraper = DrSimiScraper()
    products: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []
    try:
        print("Resolviendo cobertura de las comunas...")
        locations = scraper.resolve_locations()
        print("Descargando catalogo completo de Dr. Simi...")
        products = scraper.fetch_catalog()
        rows = build_rows(products, locations)
        write_csv(rows)
    finally:
        scraper.close()
    elapsed = time.perf_counter() - started
    unique_skus = len({row["sku"] for row in rows})
    print(f"CSV generado: {OUTPUT_FILE.resolve()}")
    print(f"Productos: {len(products)} | SKU: {unique_skus} | Filas: {len(rows)}")
    print(f"Tiempo total: {elapsed:.2f} segundos ({elapsed / 60:.2f} minutos)")


if __name__ == "__main__":
    main()

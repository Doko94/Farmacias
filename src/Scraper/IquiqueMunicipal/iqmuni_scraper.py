"""Descarga el catálogo público de la Farmacia Municipal de Iquique.

La fuente es el consultor de medicamentos de CORMUDESI. El sistema publica
precio y stock para Farmacia Central y Farmacia Sur mediante un endpoint JSON.
La salida usa el mismo esquema que consume FarmaAhorro.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


CATALOG_URL = (
    "http://unisag.cormudesi.cl/unisag/servicios/farmacia_comunal/"
    "consultor/controller/router.php"
)
PUBLIC_URL = (
    "http://unisag.cormudesi.cl/unisag/servicios/farmacia_comunal/"
    "consultor/view/consulta_medicamento.php"
)
INFO_URL = "https://www.municipioiquique.cl/salud/farmacia-municipal.html"
DEFAULT_OUTPUT = Path(__file__).with_name("iqmuni_productos.csv")
REGION = "Tarapaca"
COMMUNE = "Iquique"

FIELDS = [
    "pid", "name", "brand", "principio_activo", "price", "price_old",
    "url", "image", "region", "comuna", "category_path",
    "bioequivalente", "fonasa_price", "disponible_comuna", "stock",
    "stock_centro", "stock_sur", "dosis", "presentacion",
    "precio_unidad", "captured_at",
]


def integer(value: Any) -> int:
    """Convierte enteros publicados como texto, tolerando separadores."""
    digits = re.sub(r"[^0-9-]", "", str(value or ""))
    try:
        return max(0, int(digits))
    except ValueError:
        return 0


def clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def stable_id(row: dict[str, Any]) -> str:
    identity = "|".join(
        clean(row.get(field)).casefold()
        for field in ("nombre", "nombre_generico", "dosis", "precentacion")
    )
    return "IQM-" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16]


def infer_brand(name: str) -> str:
    """Extrae el laboratorio sólo cuando la fuente lo declara entre paréntesis."""
    matches = re.findall(r"\((?:LAB\.?\s*)?([^()]+)\)", name, flags=re.IGNORECASE)
    if not matches:
        return ""
    candidate = clean(matches[-1])
    return "" if candidate.casefold() in {"b", "bioequivalente"} else candidate


def fetch_catalog(timeout: int = 60, retries: int = 3) -> list[dict[str, Any]]:
    body = urlencode({"opcion": "consultor_new"}).encode("ascii")
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        request = Request(
            CATALOG_URL,
            data=body,
            headers={
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "User-Agent": "Mozilla/5.0 (compatible; FarmaAhorro/1.0)",
                "X-Requested-With": "XMLHttpRequest",
                "Referer": PUBLIC_URL,
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=timeout) as response:
                payload = json.loads(response.read().decode("utf-8-sig"))
            rows = payload.get("data", []) if isinstance(payload, dict) else payload
            if not isinstance(rows, list) or not rows:
                raise RuntimeError("El servicio respondió sin medicamentos")
            return rows
        except (HTTPError, URLError, TimeoutError, ValueError, RuntimeError) as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"No fue posible descargar el catálogo: {last_error}")


def transform(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    captured_at = datetime.now(timezone.utc).isoformat()
    products: list[dict[str, Any]] = []
    for source in rows:
        name = clean(source.get("nombre"))
        price = integer(source.get("precio"))
        if not name or price <= 0:
            continue
        stock_centro = integer(source.get("stock_centro"))
        stock_sur = integer(source.get("stock_sur"))
        stock = stock_centro + stock_sur
        products.append({
            "pid": stable_id(source),
            "name": name,
            "brand": infer_brand(name),
            "principio_activo": clean(source.get("principio_activo")),
            "price": price,
            "price_old": "",
            "url": INFO_URL,
            "image": "",
            "region": REGION,
            "comuna": COMMUNE,
            "category_path": "medicamentos/farmacia-municipal",
            "bioequivalente": clean(source.get("beq")).casefold() in {"si", "sí", "true", "1"},
            "fonasa_price": "",
            "disponible_comuna": stock > 0,
            "stock": stock,
            "stock_centro": stock_centro,
            "stock_sur": stock_sur,
            "dosis": clean(source.get("dosis")),
            "presentacion": clean(source.get("precentacion")),
            "precio_unidad": integer(source.get("precio_unidad")),
            "captured_at": captured_at,
        })
    return products


def save_csv(products: list[dict[str, Any]], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(products)
    temporary.replace(output)


def main() -> None:
    parser = argparse.ArgumentParser(description="Scraper Farmacia Municipal de Iquique")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--timeout", type=int, default=60)
    args = parser.parse_args()

    started = time.perf_counter()
    products = transform(fetch_catalog(timeout=args.timeout))
    save_csv(products, args.output)
    available = sum(product["disponible_comuna"] for product in products)
    elapsed = time.perf_counter() - started
    print(f"Productos exportados: {len(products)}")
    print(f"Con stock: {available}")
    print(f"Archivo: {args.output.resolve()}")
    print(f"Tiempo total: {elapsed:.2f} segundos")


if __name__ == "__main__":
    main()

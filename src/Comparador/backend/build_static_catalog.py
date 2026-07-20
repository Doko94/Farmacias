"""Genera indices JSON por ubicacion para el frontend estatico de Netlify."""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
COMPARATOR_DIR = BACKEND_DIR.parent
sys.path.insert(0, str(BACKEND_DIR))

from app.services.catalog import Catalog  # noqa: E402
from app.services.matching import normalize  # noqa: E402


OUTPUT_DIR = COMPARATOR_DIR / "frontend" / "data"
LOCATIONS = {
    normalize("Iquique"): ("Tarapaca", "Iquique"),
    normalize("Arica"): ("Arica y Parinacota", "Arica"),
    normalize("Antofagasta"): ("Antofagasta", "Antofagasta"),
}


def slug(value: str) -> str:
    value = "".join(
        char for char in unicodedata.normalize("NFD", value.casefold())
        if unicodedata.category(char) != "Mn"
    )
    return re.sub(r"[^a-z0-9]+", "-", value).strip("-")


def build() -> dict[str, int]:
    catalog = Catalog()
    grouped: dict[tuple[str, str], dict[tuple[str, str], dict]] = {}
    for offer in catalog.offers:
        location = LOCATIONS.get(normalize(offer.commune))
        if not location:
            continue
        identity = offer.sku or offer.url or normalize(offer.name)
        key = (offer.pharmacy, identity)
        grouped.setdefault(location, {})[key] = {
            "pharmacy": offer.pharmacy,
            "sku": offer.sku,
            "name": offer.name,
            "brand": offer.brand,
            "active_ingredient": offer.active_ingredient,
            "price": offer.price,
            "list_price": offer.list_price,
            "available": offer.available,
            "stock_quantity": offer.stock_quantity,
            "captured_at": offer.captured_at,
            "url": offer.url,
            "image": offer.image,
            "bioequivalent": offer.bioequivalent,
            "fonasa_price": offer.fonasa_price,
            "search_text": offer.normalized_name,
        }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {"locations": {}, "total_offers": 0}
    counts: dict[str, int] = {}
    for (region, commune), offers_by_key in grouped.items():
        filename = f"{slug(region)}--{slug(commune)}.json"
        offers = sorted(
            offers_by_key.values(),
            key=lambda item: (item["name"].casefold(), item["price"]),
        )
        (OUTPUT_DIR / filename).write_text(
            json.dumps(offers, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        location_key = f"{region}|{commune}"
        manifest["locations"][location_key] = {
            "file": filename,
            "offers": len(offers),
        }
        manifest["total_offers"] += len(offers)
        counts[location_key] = len(offers)

    (OUTPUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Catalogo estatico: {manifest['total_offers']} ofertas")
    for location, count in counts.items():
        print(f"  {location}: {count}")
    return counts


if __name__ == "__main__":
    build()

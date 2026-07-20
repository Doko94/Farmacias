from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

from ..config import CSV_SOURCES
from ..database import connect
from ..models import ProductOffer
from .matching import match_score


def _integer(value: Any) -> int | None:
    try:
        return round(float(value)) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _boolean(value: Any, default: bool = True) -> bool:
    if value in (None, ""):
        return default
    return str(value).strip().casefold() in {"true", "1", "si", "sí", "yes"}


def _pick(row: dict[str, str], *names: str) -> str:
    for name in names:
        if row.get(name) not in (None, ""):
            return row[name]
    return ""


class Catalog:
    def __init__(self, sources: dict[str, Path] | None = None) -> None:
        self.sources = sources or CSV_SOURCES
        self.offers: list[ProductOffer] = []
        self.reload()

    def reload(self) -> int:
        offers: list[ProductOffer] = []
        for pharmacy, path in self.sources.items():
            if not path.exists():
                continue
            with path.open("r", encoding="utf-8-sig", newline="") as handle:
                for row in csv.DictReader(handle):
                    price = _integer(_pick(row, "price", "precio_actual", "precio_internet"))
                    if not price or price <= 0:
                        continue
                    available_field = _pick(
                        row, "disponible_comuna", "stock_catalogo", "stock"
                    )
                    offers.append(ProductOffer(
                        pharmacy=pharmacy,
                        sku=_pick(row, "pid", "sku", "product_id"),
                        name=_pick(row, "name", "nombre"),
                        brand=_pick(row, "brand", "marca"),
                        price=price,
                        list_price=_integer(_pick(row, "price_old", "precio_normal")),
                        url=_pick(row, "url"),
                        image=_pick(row, "image", "imagen"),
                        region=_pick(row, "region"),
                        commune=_pick(row, "comuna"),
                        category=_pick(row, "category_path", "categoria_1"),
                        active_ingredient=_pick(row, "principio_activo"),
                        bioequivalent=_boolean(_pick(row, "bioequivalente"), False),
                        available=_boolean(available_field, True),
                        captured_at=_pick(row, "captured_at", "capturado_en"),
                    ))
        self.offers = offers
        return len(offers)

    def search(
        self, query: str, region: str, commune: str, limit: int = 40,
        include_unavailable: bool = False,
    ) -> list[tuple[ProductOffer, float]]:
        results = []
        for offer in self.offers:
            if offer.region.casefold() != region.casefold():
                continue
            if offer.commune.casefold() != commune.casefold():
                continue
            if not include_unavailable and not offer.available:
                continue
            score = match_score(query, offer.normalized_name)
            if score >= 0.48:
                results.append((offer, score))
        results.sort(key=lambda item: (-item[1], item[0].price))
        return results[:limit]

    def snapshot_history(self) -> int:
        inserted = 0
        with connect() as connection:
            for offer in self.offers:
                if not offer.captured_at:
                    continue
                cursor = connection.execute(
                    """INSERT OR IGNORE INTO price_history
                    (pharmacy, sku, name, price, region, commune, captured_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (offer.pharmacy, offer.sku, offer.name, offer.price,
                     offer.region, offer.commune, offer.captured_at),
                )
                inserted += cursor.rowcount
        return inserted

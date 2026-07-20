from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass(slots=True)
class ProductOffer:
    pharmacy: str
    sku: str
    name: str
    brand: str
    price: int
    list_price: int | None
    url: str
    image: str
    region: str
    commune: str
    category: str = ""
    active_ingredient: str = ""
    bioequivalent: bool = False
    available: bool = True
    captured_at: str = ""
    normalized_name: str = field(init=False)

    def __post_init__(self) -> None:
        from .services.matching import normalize

        self.normalized_name = normalize(
            " ".join((self.name, self.brand, self.active_ingredient))
        )


@dataclass(slots=True)
class PricePoint:
    pharmacy: str
    sku: str
    price: int
    captured_at: datetime

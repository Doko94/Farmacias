from __future__ import annotations

from collections import Counter

from .catalog import Catalog


def summary(catalog: Catalog, region: str, commune: str) -> dict:
    offers = [
        offer for offer in catalog.offers
        if offer.region.casefold() == region.casefold()
        and offer.commune.casefold() == commune.casefold()
    ]
    pharmacies = Counter(offer.pharmacy for offer in offers)
    discounts = [
        round((offer.list_price - offer.price) * 100 / offer.list_price)
        for offer in offers if offer.list_price and offer.price < offer.list_price
    ]
    return {
        "offers": len(offers), "available": sum(offer.available for offer in offers),
        "pharmacies": pharmacies, "average_discount_pct": (
            round(sum(discounts) / len(discounts), 1) if discounts else 0
        ),
    }

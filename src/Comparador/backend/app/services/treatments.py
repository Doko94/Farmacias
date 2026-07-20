from __future__ import annotations

import math

from ..schemas import TreatmentRequest
from .catalog import Catalog


def calculate_monthly(catalog: Catalog, request: TreatmentRequest) -> dict:
    detail = []
    total = 0
    for item in request.items:
        required_units = item.units_per_dose * item.doses_per_day * request.days
        packages = math.ceil(required_units / item.units_per_package)
        matches = catalog.search(item.query, request.region, request.commune, limit=1)
        if not matches:
            detail.append({"query": item.query, "found": False, "packages": packages})
            continue
        offer, score = matches[0]
        subtotal = offer.price * packages
        total += subtotal
        detail.append({
            "query": item.query, "found": True, "packages": packages,
            "required_units": required_units, "pharmacy": offer.pharmacy,
            "product": offer.name, "unit_price": offer.price,
            "subtotal": subtotal, "match_score": round(score, 3), "url": offer.url,
        })
    return {"days": request.days, "total": total, "items": detail}

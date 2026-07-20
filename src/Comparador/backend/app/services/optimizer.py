from __future__ import annotations

from itertools import combinations

from ..config import DEFAULT_SHIPPING_COSTS
from ..schemas import OptimizationRequest
from .catalog import Catalog


def optimize_recipe(catalog: Catalog, request: OptimizationRequest) -> dict:
    offers_by_item: list[dict[str, tuple]] = []
    missing = []
    for item in request.items:
        matches = catalog.search(item.query, request.region, request.commune, limit=100)
        cheapest: dict[str, tuple] = {}
        for offer, score in matches:
            current = cheapest.get(offer.pharmacy)
            if current is None or offer.price < current[0].price:
                cheapest[offer.pharmacy] = (offer, score, item.quantity)
        if not cheapest:
            missing.append(item.query)
        offers_by_item.append(cheapest)
    if missing:
        return {"ok": False, "missing": missing, "message": "Faltan productos por cotizar"}

    pharmacies = sorted({p for item in offers_by_item for p in item})
    shipping = {**DEFAULT_SHIPPING_COSTS, **request.shipping_costs}

    def quote(selected: tuple[str, ...]) -> dict | None:
        lines, subtotal = [], 0
        for request_item, available in zip(request.items, offers_by_item):
            options = [(p, available[p]) for p in selected if p in available]
            if not options:
                return None
            pharmacy, (offer, score, quantity) = min(
                options, key=lambda pair: pair[1][0].price
            )
            line_total = offer.price * quantity
            subtotal += line_total
            lines.append({
                "query": request_item.query, "pharmacy": pharmacy,
                "product": offer.name, "quantity": quantity,
                "unit_price": offer.price, "subtotal": line_total,
                "score": round(score, 3), "url": offer.url,
            })
        delivery = 0 if request.pickup else sum(shipping.get(p, 3990) for p in selected)
        return {
            "pharmacies": list(selected), "lines": lines, "subtotal": subtotal,
            "shipping": delivery, "total": subtotal + delivery,
        }

    candidates = []
    for size in range(1, min(request.max_pharmacies, len(pharmacies)) + 1):
        for selected in combinations(pharmacies, size):
            candidate = quote(selected)
            if candidate:
                candidates.append(candidate)
    candidates.sort(key=lambda candidate: (candidate["total"], len(candidate["pharmacies"])))
    best = candidates[0]
    single = min(
        (candidate for candidate in candidates if len(candidate["pharmacies"]) == 1),
        key=lambda candidate: candidate["total"], default=None,
    )
    savings = (single["total"] - best["total"]) if single else 0
    if single and len(best["pharmacies"]) > 1 and savings < request.minimum_split_savings:
        best = single
        savings = 0
    return {"ok": True, "recommendation": best, "best_single": single, "savings": savings}

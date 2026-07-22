from __future__ import annotations

from dataclasses import asdict
import re

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .database import initialize
from .schemas import AlertRequest, OptimizationRequest, TreatmentRequest
from .services.alerts import create_alert, evaluate_alerts
from .services.analytics import summary
from .services.catalog import Catalog
from .services.history import get_history
from .services.optimizer import optimize_recipe
from .services.prescriptions import extract_text, parse_medicines
from .services.treatments import calculate_monthly

app = FastAPI(
    title="AhorraMed API", version="0.1.0",
    description="Comparador informativo de precios de medicamentos en Chile.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=False,
    allow_methods=["*"], allow_headers=["*"],
)
initialize()
catalog = Catalog()


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "offers": len(catalog.offers)}


@app.post("/api/catalog/reload")
def reload_catalog() -> dict:
    count = catalog.reload()
    inserted = catalog.snapshot_history()
    return {"offers": count, "history_inserted": inserted}


@app.get("/api/search")
def search(
    q: str = Query(min_length=2, max_length=100), region: str = "Tarapaca",
    commune: str = "Iquique", limit: int = Query(default=40, ge=1, le=200),
) -> dict:
    q = " ".join(q.split()).strip()
    if len(re.findall(r"[^\W\d_]", q, flags=re.UNICODE)) < 2:
        raise HTTPException(status_code=422, detail="La búsqueda debe incluir al menos dos letras")
    if any(
        not (character.isalnum() or character.isspace() or character in ".,/%()+-")
        for character in q
    ):
        raise HTTPException(status_code=422, detail="La búsqueda contiene caracteres no permitidos")
    if re.search(r"(.)\1{7,}", q, flags=re.IGNORECASE):
        raise HTTPException(status_code=422, detail="La búsqueda contiene repeticiones excesivas")
    if any(len(token) > 40 for token in q.split()):
        raise HTTPException(status_code=422, detail="La búsqueda contiene una palabra demasiado larga")
    results = catalog.search(q, region, commune, limit)
    return {
        "query": q,
        "results": [{**asdict(offer), "score": round(score, 3)} for offer, score in results],
    }


@app.get("/api/bioequivalents")
def bioequivalents(q: str, region: str = "Tarapaca", commune: str = "Iquique") -> dict:
    matches = catalog.search(q, region, commune, 100)
    baseline = max((offer.price for offer, _ in matches), default=0)
    results = []
    for offer, score in matches:
        if offer.bioequivalent or "bioequival" in offer.normalized_name:
            results.append({
                **asdict(offer), "score": round(score, 3),
                "savings": baseline - offer.price,
                "savings_pct": round((baseline - offer.price) * 100 / baseline) if baseline else 0,
            })
    return {"baseline": baseline, "results": results}


@app.post("/api/treatments/monthly-cost")
def treatment_cost(request: TreatmentRequest) -> dict:
    return calculate_monthly(catalog, request)


@app.post("/api/recipes/optimize")
def optimize(request: OptimizationRequest) -> dict:
    return optimize_recipe(catalog, request)


@app.post("/api/recipes/extract")
async def extract_recipe(file: UploadFile = File(...)) -> dict:
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(413, "El archivo supera el limite de 10 MB")
    try:
        text, method = extract_text(file.filename or "receta", content)
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"method": method, "text": text, "medicines": parse_medicines(text)}


@app.post("/api/alerts")
def alerts(request: AlertRequest) -> dict:
    return create_alert(request)


@app.post("/api/alerts/evaluate")
def run_alerts() -> dict:
    events = evaluate_alerts(catalog)
    return {"events": events, "note": "Conecta un proveedor de email para enviarlos."}


@app.get("/api/history/{pharmacy}/{sku}")
def history(pharmacy: str, sku: str, region: str, commune: str) -> dict:
    return {"points": get_history(pharmacy, sku, region, commune)}


@app.get("/api/analytics/summary")
def analytics(region: str = "Tarapaca", commune: str = "Iquique") -> dict:
    return summary(catalog, region, commune)

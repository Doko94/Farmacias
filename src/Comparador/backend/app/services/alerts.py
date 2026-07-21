from __future__ import annotations

from datetime import datetime, timezone

from ..database import connect
from ..schemas import AlertRequest
from .catalog import Catalog


def create_alert(request: AlertRequest) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    with connect() as connection:
        cursor = connection.execute(
            """INSERT INTO alerts
            (email, query, target_price, region, commune, enabled, created_at)
            VALUES (?, ?, ?, ?, ?, 1, ?)""",
            (request.email, request.query, request.target_price,
             request.region, request.commune, now),
        )
        alert_id = cursor.lastrowid
    return {"id": alert_id, "created_at": now, **request.model_dump()}


def evaluate_alerts(catalog: Catalog) -> list[dict]:
    events = []
    now = datetime.now(timezone.utc).isoformat()
    with connect() as connection:
        alerts = connection.execute("SELECT * FROM alerts WHERE enabled = 1").fetchall()
        for alert in alerts:
            matches = catalog.search(
                alert["query"], alert["region"], alert["commune"], limit=1
            )
            if not matches:
                continue
            offer, _score = matches[0]
            history = connection.execute(
                """SELECT price, captured_at FROM price_history
                WHERE pharmacy = ? AND sku = ? AND region = ? AND commune = ?
                ORDER BY captured_at DESC LIMIT 2""",
                (offer.pharmacy, offer.sku, alert["region"], alert["commune"]),
            ).fetchall()
            if len(history) < 2:
                continue
            current, previous = history[0], history[1]
            if current["captured_at"] <= alert["created_at"] or current["price"] >= previous["price"]:
                continue
            existing = connection.execute(
                """SELECT id FROM alert_events
                WHERE alert_id = ? AND pharmacy = ? AND sku = ? AND price = ?""",
                (alert["id"], offer.pharmacy, offer.sku, offer.price),
            ).fetchone()
            if existing:
                continue
            connection.execute(
                """INSERT INTO alert_events
                (alert_id, pharmacy, sku, price, detected_at)
                VALUES (?, ?, ?, ?, ?)""",
                (alert["id"], offer.pharmacy, offer.sku, offer.price, now),
            )
            events.append({
                "alert_id": alert["id"], "email": alert["email"],
                "query": alert["query"], "pharmacy": offer.pharmacy,
                "product": offer.name, "price": offer.price,
                "previous_price": previous["price"],
                "drop_amount": previous["price"] - offer.price,
                "url": offer.url,
            })
    return events

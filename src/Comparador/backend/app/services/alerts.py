from __future__ import annotations

from datetime import datetime, timedelta, timezone
import secrets

from ..database import connect
from ..schemas import AlertRequest
from .catalog import Catalog


class AlertRateLimitError(ValueError):
    pass


def create_alert(request: AlertRequest) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    with connect() as connection:
        recent = connection.execute(
            """SELECT COUNT(*) FROM alerts
            WHERE email = ? AND created_at >= ?""",
            (request.email, (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()),
        ).fetchone()[0]
        if recent >= 5:
            raise AlertRateLimitError("Demasiadas solicitudes. Intenta nuevamente más tarde.")
        duplicate = connection.execute(
            """SELECT id FROM alerts WHERE email = ? AND query = ? AND region = ?
            AND commune = ? AND enabled = 1""",
            (request.email, request.query, request.region, request.commune),
        ).fetchone()
        if duplicate:
            return {
                "status": "pending_confirmation",
                "message": "Si la dirección es válida, recibirás instrucciones para confirmar la alerta.",
                "delivery_configured": False,
            }
        token = secrets.token_urlsafe(32)
        cursor = connection.execute(
            """INSERT INTO alerts
            (email, query, target_price, region, commune, enabled, confirmed,
             confirmation_token, created_at)
            VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)""",
            (request.email, request.query, request.target_price,
             request.region, request.commune, token, now),
        )
        alert_id = cursor.lastrowid
    return {
        "id": alert_id,
        "status": "pending_confirmation",
        "message": "Si la dirección es válida, recibirás instrucciones para confirmar la alerta.",
        "delivery_configured": False,
    }


def confirm_alert(token: str) -> bool:
    with connect() as connection:
        cursor = connection.execute(
            """UPDATE alerts SET confirmed = 1
            WHERE confirmation_token = ? AND enabled = 1 AND cancelled_at IS NULL""",
            (token,),
        )
        return cursor.rowcount > 0


def cancel_alert(token: str) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    with connect() as connection:
        cursor = connection.execute(
            """UPDATE alerts SET enabled = 0, cancelled_at = ?
            WHERE confirmation_token = ? AND enabled = 1""",
            (now, token),
        )
        return cursor.rowcount > 0


def evaluate_alerts(catalog: Catalog) -> list[dict]:
    events = []
    now = datetime.now(timezone.utc).isoformat()
    with connect() as connection:
        alerts = connection.execute(
            "SELECT * FROM alerts WHERE enabled = 1 AND confirmed = 1"
        ).fetchall()
        for alert in alerts:
            if alert["last_notified_at"]:
                last = datetime.fromisoformat(alert["last_notified_at"])
                if datetime.now(timezone.utc) - last < timedelta(hours=24):
                    continue
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
            connection.execute(
                "UPDATE alerts SET last_notified_at = ? WHERE id = ?",
                (now, alert["id"]),
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

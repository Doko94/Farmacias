from __future__ import annotations

from ..database import connect


def get_history(pharmacy: str, sku: str, region: str, commune: str) -> list[dict]:
    with connect() as connection:
        rows = connection.execute(
            """SELECT price, captured_at FROM price_history
            WHERE pharmacy = ? AND sku = ? AND region = ? AND commune = ?
            ORDER BY captured_at""",
            (pharmacy, sku, region, commune),
        ).fetchall()
    return [dict(row) for row in rows]

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from .config import DATABASE_PATH


SCHEMA = """
CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pharmacy TEXT NOT NULL,
    sku TEXT NOT NULL,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    region TEXT NOT NULL,
    commune TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    UNIQUE(pharmacy, sku, region, commune, captured_at)
);
CREATE INDEX IF NOT EXISTS idx_history_product
ON price_history(pharmacy, sku, captured_at);

CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    query TEXT NOT NULL,
    target_price INTEGER,
    region TEXT NOT NULL,
    commune TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    confirmed INTEGER NOT NULL DEFAULT 0,
    confirmation_token TEXT,
    cancelled_at TEXT,
    last_notified_at TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alert_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_id INTEGER NOT NULL REFERENCES alerts(id),
    pharmacy TEXT NOT NULL,
    sku TEXT NOT NULL,
    price INTEGER NOT NULL,
    detected_at TEXT NOT NULL,
    delivered_at TEXT
);
"""


def initialize(path: Path = DATABASE_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as connection:
        connection.executescript(SCHEMA)
        columns = {
            row[1] for row in connection.execute("PRAGMA table_info(alerts)").fetchall()
        }
        migrations = {
            "confirmed": "ALTER TABLE alerts ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0",
            "confirmation_token": "ALTER TABLE alerts ADD COLUMN confirmation_token TEXT",
            "cancelled_at": "ALTER TABLE alerts ADD COLUMN cancelled_at TEXT",
            "last_notified_at": "ALTER TABLE alerts ADD COLUMN last_notified_at TEXT",
        }
        for column, statement in migrations.items():
            if column not in columns:
                connection.execute(statement)
        connection.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_confirmation_token "
            "ON alerts(confirmation_token)"
        )


@contextmanager
def connect(path: Path = DATABASE_PATH) -> Iterator[sqlite3.Connection]:
    initialize(path)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()

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

from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]
PROJECT_ROOT = BASE_DIR.parent
SCRAPER_DIR = PROJECT_ROOT / "Scraper"
DATABASE_PATH = BASE_DIR / "comparador.db"

CSV_SOURCES = {
    "Ahumada": SCRAPER_DIR / "Ahumada" / "ahumada_productos.csv",
    "Cruz Verde": SCRAPER_DIR / "CruzVerde" / "cruzverde_productos.csv",
    "Salcobrand": SCRAPER_DIR / "Salcobrand" / "salcobrand_productos.csv",
    "Dr. Simi": SCRAPER_DIR / "DrSimi" / "drsimi_productos.csv",
}

DEFAULT_SHIPPING_COSTS = {
    "Ahumada": 3990,
    "Cruz Verde": 3990,
    "Salcobrand": 3990,
    "Dr. Simi": 3990,
}

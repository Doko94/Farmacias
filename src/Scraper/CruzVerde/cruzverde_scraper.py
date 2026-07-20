"""Scraper de todos los productos de Cruz Verde para comunas seleccionadas.

La tienda es una SPA Angular. Sus productos, categorias e inventarios se
obtienen desde la API JSON publica que utiliza el propio sitio.

Dependencias:
    pip install "httpx[http2]" pydantic truststore
"""

from __future__ import annotations

import asyncio
import csv
import random
import re
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

import httpx
from pydantic import BaseModel, Field, field_validator

try:
    import truststore

    truststore.inject_into_ssl()
    _TRUSTSTORE_OK = True
except ImportError:
    _TRUSTSTORE_OK = False


SITE_URL = "https://www.cruzverde.cl"
API_URL = "https://api.cruzverde.cl"
OUTPUT_FILE = "cruzverde_productos.csv"

TARGET_LOCATIONS = {
    ("Tarapacá", "Iquique"),
    ("Arica y Parinacota", "Arica"),
    ("Antofagasta", "Antofagasta"),
}

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
]


class Product(BaseModel):
    pid: str
    name: str
    brand: Optional[str] = None
    url: str
    image: Optional[str] = None
    price: Optional[int] = Field(None, description="Precio vigente en CLP")
    price_old: Optional[int] = Field(None, description="Precio normal en CLP")
    discount_pct: Optional[int] = None
    stock: Optional[int] = None
    store_pickup: Optional[bool] = None
    home_delivery: Optional[bool] = None
    region: str
    comuna: str
    category_path: Optional[str] = None
    captured_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    @field_validator("price", "price_old", "stock", mode="before")
    @classmethod
    def to_int(cls, value):
        if value is None or isinstance(value, int):
            return value
        if isinstance(value, float):
            return int(value)
        digits = re.sub(r"[^\d]", "", str(value))
        return int(digits) if digits else None


class CruzVerdeScraper:
    def __init__(
        self,
        concurrency: int = 4,
        page_size: int = 100,
        min_delay: float = 0.3,
        max_delay: float = 0.8,
    ) -> None:
        self._sem = asyncio.Semaphore(concurrency)
        self._page_size = page_size
        self._min_delay = min_delay
        self._max_delay = max_delay
        self._client: Optional[httpx.AsyncClient] = None
        self._login_lock = asyncio.Lock()

    async def __aenter__(self) -> "CruzVerdeScraper":
        self._client = httpx.AsyncClient(
            base_url=API_URL,
            http2=True,
            follow_redirects=True,
            timeout=httpx.Timeout(45.0),
            headers={
                "Accept": "application/json",
                "Accept-Language": "es-CL,es;q=0.9",
                "Origin": SITE_URL,
                "Referer": f"{SITE_URL}/",
                "User-Agent": random.choice(USER_AGENTS),
            },
        )
        await self.login_anonymous()
        return self

    async def __aexit__(self, *_exc) -> None:
        if self._client:
            await self._client.aclose()

    async def login_anonymous(self) -> None:
        """Crea la sesion invitada requerida por la busqueda de productos."""
        async with self._login_lock:
            response = await self._client.post(
                "/customer-service/login", json={}
            )
            response.raise_for_status()
            payload = response.json()
            if payload.get("authType") != "guest":
                raise RuntimeError("Cruz Verde no creo una sesion de invitado")

    async def _get(
        self,
        endpoint: str,
        *,
        params: Any = None,
        refresh_session: bool = True,
    ) -> httpx.Response:
        retry_statuses = {429, 500, 502, 503, 504}
        max_attempts = 4

        for attempt in range(1, max_attempts + 1):
            try:
                async with self._sem:
                    await asyncio.sleep(
                        random.uniform(self._min_delay, self._max_delay)
                    )
                    response = await self._client.get(endpoint, params=params)

                # Se renueva fuera del semaforo para evitar un interbloqueo si
                # varias solicitudes reciben 401 al mismo tiempo.
                if response.status_code == 401 and refresh_session:
                    await self.login_anonymous()
                    return await self._get(
                        endpoint, params=params, refresh_session=False
                    )
                if response.status_code in retry_statuses:
                    raise httpx.HTTPStatusError(
                        "respuesta reintentable",
                        request=response.request,
                        response=response,
                    )
                response.raise_for_status()
                return response
            except httpx.HTTPError:
                if attempt == max_attempts:
                    raise
                await asyncio.sleep((2**attempt) + random.random())

        raise RuntimeError("No fue posible completar la solicitud")

    async def discover_locations(self) -> list[dict[str, str]]:
        """Resuelve region, comuna e inventoryId desde la API del sitio."""
        response = await self._get("/product-service/zones")
        payload = response.json()
        values = payload.get("values", {})
        locations: list[dict[str, str]] = []

        for region, communes in values.items():
            for commune in communes:
                pair = (region, commune.get("name"))
                if pair not in TARGET_LOCATIONS:
                    continue
                detail_response = await self._get(
                    f"/product-service/zones/{commune['id']}"
                )
                detail = detail_response.json()
                inventory_id = detail.get("inventoryId")
                if inventory_id:
                    locations.append(
                        {
                            "region": region,
                            "comuna": commune["name"],
                            "commune_id": commune["id"],
                            "inventory_id": inventory_id,
                        }
                    )

        found = {(item["region"], item["comuna"]) for item in locations}
        missing = TARGET_LOCATIONS.difference(found)
        if missing:
            names = ", ".join(
                f"{region} / {comuna}" for region, comuna in sorted(missing)
            )
            raise RuntimeError(f"Ubicaciones no encontradas: {names}")
        return locations

    async def discover_categories(self) -> list[dict[str, str]]:
        """Obtiene todas las categorias con productos visibles en el menu."""
        response = await self._get(
            "/product-service/categories/category-tree",
            params={"showInMenu": "true"},
        )
        tree = response.json()
        categories: dict[str, dict[str, str]] = {}

        def walk(nodes: Iterable[dict], parent_path: str = "") -> None:
            for node in nodes or []:
                category_id = str(node.get("id", "")).strip()
                path = str(node.get("path") or parent_path).strip()
                if (
                    category_id
                    and node.get("showInMenu", True)
                    and node.get("hasOnlineProducts", True)
                ):
                    categories[category_id] = {
                        "id": category_id,
                        "path": path,
                    }
                walk(node.get("categories", []), path)

        walk(tree)
        if not categories:
            raise RuntimeError("Cruz Verde no devolvio categorias")
        return list(categories.values())

    @staticmethod
    def _slugify(value: str) -> str:
        normalized = unicodedata.normalize("NFKD", value)
        ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
        return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")

    @classmethod
    def parse_hit(
        cls,
        hit: dict,
        *,
        region: str,
        comuna: str,
        category_path: str,
    ) -> Product:
        pid = str(hit.get("productId", "")).strip()
        name = str(hit.get("productName", "")).strip()
        prices = hit.get("prices") or {}
        sale_price = prices.get("price-sale-cl")
        list_price = prices.get("price-list-cl")
        current_price = sale_price if sale_price is not None else list_price
        old_price = (
            list_price
            if list_price is not None and list_price != current_price
            else None
        )
        image = hit.get("image") or {}

        return Product(
            pid=pid,
            name=name,
            brand=hit.get("brand"),
            url=f"{SITE_URL}/{cls._slugify(name)}/{pid}.html",
            image=image.get("disBaseLink") or image.get("link"),
            price=current_price,
            price_old=old_price,
            discount_pct=hit.get("discountPercentage"),
            stock=hit.get("stock"),
            store_pickup=hit.get("storePickup"),
            home_delivery=hit.get("homeDelivery"),
            region=region,
            comuna=comuna,
            category_path=category_path,
        )

    async def crawl_category(
        self,
        category: dict[str, str],
        location: dict[str, str],
    ) -> list[Product]:
        products: list[Product] = []
        offset = 0

        while True:
            params = [
                ("limit", str(self._page_size)),
                ("offset", str(offset)),
                ("sort", ""),
                ("q", ""),
                ("refine[]", f"cgid={category['id']}"),
                ("inventoryId", location["inventory_id"]),
                ("inventoryZone", location["inventory_id"]),
                ("requestPage", "CLP"),
            ]
            response = await self._get(
                "/product-service/products/search", params=params
            )
            payload = response.json()
            hits = payload.get("hits") or []
            for hit in hits:
                if hit.get("productId") and hit.get("productName"):
                    products.append(
                        self.parse_hit(
                            hit,
                            region=location["region"],
                            comuna=location["comuna"],
                            category_path=category["path"],
                        )
                    )

            offset += len(hits)
            total = int(payload.get("total") or 0)
            if not hits or offset >= total:
                break

        return products

    async def crawl_location(
        self,
        categories: list[dict[str, str]],
        location: dict[str, str],
    ) -> list[Product]:
        tasks = [self.crawl_category(category, location) for category in categories]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        products_by_pid: dict[str, Product] = {}

        for category, result in zip(categories, results):
            if isinstance(result, Exception):
                print(
                    f"[WARN] Fallo categoria {category['id']!r}: {result!r}"
                )
                continue
            for product in result:
                products_by_pid.setdefault(product.pid, product)

        return list(products_by_pid.values())


def save_csv(
    products: list[Product],
    path: str | Path,
    *,
    append: bool = False,
) -> None:
    path = Path(path)
    mode = "a" if append else "w"
    encoding = "utf-8" if append else "utf-8-sig"
    with path.open(mode, encoding=encoding, newline="") as file:
        writer = csv.DictWriter(file, fieldnames=list(Product.model_fields))
        if not append:
            writer.writeheader()
        writer.writerows(product.model_dump() for product in products)
    print(f"[OK] {len(products)} productos -> {path}")


def format_duration(seconds: float) -> str:
    total = max(0, round(seconds))
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


async def run_scraping() -> None:
    print(f"[INFO] truststore activo: {_TRUSTSTORE_OK}")
    output_path = Path(__file__).with_name(OUTPUT_FILE)
    save_csv([], output_path)

    async with CruzVerdeScraper(concurrency=4, page_size=100) as scraper:
        locations, categories = await asyncio.gather(
            scraper.discover_locations(), scraper.discover_categories()
        )
        print(
            f"[INFO] {len(locations)} ubicaciones y "
            f"{len(categories)} categorias detectadas"
        )

        successful_locations = 0
        for index, location in enumerate(locations, start=1):
            started = time.perf_counter()
            label = f"{location['region']} / {location['comuna']}"
            print(f"[INFO] [{index}/{len(locations)}] {label}")
            try:
                products = await scraper.crawl_location(categories, location)
                save_csv(products, output_path, append=True)
                successful_locations += 1
            except httpx.HTTPError as exc:
                print(f"[WARN] Fallo {label}: {exc!r}")
            finally:
                print(
                    f"[TIEMPO] {label}: "
                    f"{format_duration(time.perf_counter() - started)}"
                )

        print(
            f"[FIN] {successful_locations}/{len(locations)} ubicaciones "
            f"procesadas -> {output_path}"
        )


async def main() -> None:
    started = time.perf_counter()
    try:
        await run_scraping()
    finally:
        print(
            f"[TIEMPO TOTAL] {format_duration(time.perf_counter() - started)}"
        )


if __name__ == "__main__":
    asyncio.run(main())

"""Ejecuta todos los scrapers de farmacias desde un solo comando.

Para agregar una farmacia nueva basta con incorporar el nombre de su archivo
Python en ``SCRAPER_FILES``. El archivo puede estar en cualquier subcarpeta de
``src/Scraper``; este orquestador lo localiza automáticamente.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path


# Agrega aquí únicamente el nombre del archivo de cada scraper.
SCRAPER_FILES = [
    "ahumada_scraper.py",
    "cruzverde_scraper.py",
    "drsimi_scraper.py",
    "salcobrand_scraper.py",
    "iqmuni_scraper.py",
]

SCRAPER_ROOT = Path(__file__).resolve().parents[1]
PROJECT_SRC = SCRAPER_ROOT.parent
CATALOG_BUILDER = PROJECT_SRC / "Comparador" / "backend" / "build_static_catalog.py"
COMPARATOR_DIR = PROJECT_SRC / "Comparador"


@dataclass(frozen=True)
class RunResult:
    filename: str
    path: Path | None
    returncode: int
    elapsed_seconds: float
    message: str = ""

    @property
    def succeeded(self) -> bool:
        return self.returncode == 0


def format_duration(seconds: float) -> str:
    total = max(0, round(seconds))
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def find_scraper(filename: str) -> Path:
    """Localiza un scraper por nombre y evita ejecutar un archivo ambiguo."""
    matches = [
        path.resolve()
        for path in SCRAPER_ROOT.rglob(filename)
        if path.is_file() and path.resolve() != Path(__file__).resolve()
    ]
    if not matches:
        raise FileNotFoundError(
            f"No se encontró {filename!r} dentro de {SCRAPER_ROOT}"
        )
    if len(matches) > 1:
        locations = "\n  - ".join(str(path) for path in matches)
        raise RuntimeError(
            f"Hay más de un archivo llamado {filename!r}:\n  - {locations}"
        )
    return matches[0]


def run_scraper(filename: str) -> RunResult:
    started = time.perf_counter()
    try:
        script = find_scraper(filename)
    except (FileNotFoundError, RuntimeError) as exc:
        return RunResult(
            filename=filename,
            path=None,
            returncode=2,
            elapsed_seconds=time.perf_counter() - started,
            message=str(exc),
        )

    print("\n" + "=" * 78, flush=True)
    print(f"INICIANDO: {filename}", flush=True)
    print(f"RUTA:      {script}", flush=True)
    print("=" * 78, flush=True)

    try:
        completed = subprocess.run(
            [sys.executable, "-u", str(script)],
            cwd=script.parent,
            check=False,
        )
        returncode = completed.returncode
        message = ""
    except OSError as exc:
        returncode = 1
        message = f"No fue posible iniciar el proceso: {exc}"

    elapsed = time.perf_counter() - started
    status = "OK" if returncode == 0 else f"ERROR ({returncode})"
    print(
        f"\nFINALIZADO: {filename} | {status} | {format_duration(elapsed)}",
        flush=True,
    )
    return RunResult(filename, script, returncode, elapsed, message)


def rebuild_static_catalog() -> int:
    """Reconstruye y valida el catalogo que Netlify publicara."""
    print("\n" + "=" * 78, flush=True)
    print("GENERANDO CATALOGO ESTATICO PARA NETLIFY", flush=True)
    print(f"RUTA: {CATALOG_BUILDER}", flush=True)
    print("=" * 78, flush=True)

    if not CATALOG_BUILDER.is_file():
        print(f"[ERROR] No se encontro {CATALOG_BUILDER}", file=sys.stderr)
        return 2

    try:
        completed = subprocess.run(
            [sys.executable, "-u", str(CATALOG_BUILDER)],
            cwd=COMPARATOR_DIR,
            check=False,
        )
    except OSError as exc:
        print(f"[ERROR] No fue posible generar el catalogo: {exc}", file=sys.stderr)
        return 1

    if completed.returncode == 0:
        print("[OK] Catalogo estatico validado. Ya puedes crear el commit.")
    else:
        print(
            f"[ERROR] El catalogo no pudo generarse (codigo {completed.returncode}).",
            file=sys.stderr,
        )
    return completed.returncode


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Ejecuta en secuencia todos los scrapers configurados."
    )
    parser.add_argument(
        "--solo",
        metavar="ARCHIVO",
        help="Ejecuta únicamente un archivo de SCRAPER_FILES.",
    )
    parser.add_argument(
        "--detener-al-fallar",
        action="store_true",
        help="No continúa con los siguientes scrapers después de un error.",
    )
    parser.add_argument(
        "--listar",
        action="store_true",
        help="Muestra los scrapers configurados sin ejecutarlos.",
    )
    parser.add_argument(
        "--sin-catalogo",
        action="store_true",
        help="No reconstruye el catalogo estatico al finalizar.",
    )
    return parser.parse_args()


def print_summary(results: list[RunResult], elapsed: float) -> None:
    print("\n" + "=" * 78)
    print("RESUMEN DE EJECUCIÓN")
    print("=" * 78)
    for result in results:
        status = "OK" if result.succeeded else f"ERROR ({result.returncode})"
        print(
            f"{status:<12} {format_duration(result.elapsed_seconds):>8}  "
            f"{result.filename}"
        )
        if result.message:
            print(f"             {result.message}")

    succeeded = sum(result.succeeded for result in results)
    print("-" * 78)
    print(
        f"Completados: {succeeded}/{len(results)} | "
        f"Tiempo total: {format_duration(elapsed)}"
    )


def main() -> int:
    args = parse_args()
    files = list(dict.fromkeys(SCRAPER_FILES))

    if args.listar:
        print("Scrapers configurados:")
        for filename in files:
            try:
                print(f"  - {filename}: {find_scraper(filename)}")
            except (FileNotFoundError, RuntimeError) as exc:
                print(f"  - {filename}: ERROR - {exc}")
        return 0

    if args.solo:
        if args.solo not in files:
            print(
                f"{args.solo!r} no está configurado en SCRAPER_FILES.",
                file=sys.stderr,
            )
            return 2
        files = [args.solo]

    started = time.perf_counter()
    results: list[RunResult] = []

    try:
        for filename in files:
            result = run_scraper(filename)
            results.append(result)
            if not result.succeeded and args.detener_al_fallar:
                break
    except KeyboardInterrupt:
        print("\nEjecución cancelada por el usuario.", file=sys.stderr)
        return 130

    elapsed = time.perf_counter() - started
    print_summary(results, elapsed)
    all_succeeded = bool(results) and all(result.succeeded for result in results)
    if all_succeeded and not args.sin_catalogo:
        all_succeeded = rebuild_static_catalog() == 0
    elif not all_succeeded and not args.sin_catalogo:
        print(
            "[WARN] No se genero el catalogo porque uno o mas scrapers fallaron.",
            file=sys.stderr,
        )
    return 0 if all_succeeded else 1


if __name__ == "__main__":
    raise SystemExit(main())

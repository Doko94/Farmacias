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
    return 0 if results and all(result.succeeded for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())

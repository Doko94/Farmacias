from __future__ import annotations

import io
import re
from pathlib import Path


MEDICINE_LINE = re.compile(
    r"(?P<name>[A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ\s-]{2,})"
    r"(?:\s+(?P<dose>\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ml)))?",
    re.IGNORECASE,
)


def extract_text(filename: str, content: bytes) -> tuple[str, str]:
    suffix = Path(filename).suffix.casefold()
    if suffix == ".pdf":
        try:
            from pypdf import PdfReader
        except ImportError as exc:
            raise RuntimeError("Instala pypdf para procesar recetas PDF") from exc
        reader = PdfReader(io.BytesIO(content))
        return "\n".join(page.extract_text() or "" for page in reader.pages), "pdf"
    if suffix in {".png", ".jpg", ".jpeg", ".webp"}:
        try:
            import pytesseract
            from PIL import Image
        except ImportError as exc:
            raise RuntimeError("Instala pillow y pytesseract para procesar fotos") from exc
        return pytesseract.image_to_string(Image.open(io.BytesIO(content)), lang="spa"), "ocr"
    raise ValueError("Formato no soportado. Usa PDF, PNG, JPG, JPEG o WEBP")


def parse_medicines(text: str) -> list[dict]:
    results, seen = [], set()
    for raw_line in text.splitlines():
        line = " ".join(raw_line.split()).strip(" -•\t")
        if len(line) < 4 or len(line) > 100:
            continue
        match = MEDICINE_LINE.search(line)
        if not match:
            continue
        name = match.group("name").strip()
        dose = (match.group("dose") or "").strip()
        query = f"{name} {dose}".strip()
        key = query.casefold()
        if key not in seen:
            results.append({"query": query, "source_line": line, "confidence": 0.6})
            seen.add(key)
    return results[:30]

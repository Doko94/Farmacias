from __future__ import annotations

import io
import re
from pathlib import Path


MEDICINE_LINE = re.compile(
    r"(?P<name>[A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ\s-]{2,})"
    r"(?:\s+(?P<dose>(?:\d{1,3}(?:[.\s]\d{3})+|\d+(?:[.,]\d+)?)\s*(?:mg|mcg|ug|g|ml|ui|iu|u|%)))?",
    re.IGNORECASE,
)

DOSE_PATTERN = re.compile(
    r"\b(?P<number>\d{1,3}(?:[.\s]\d{3})+|\d+(?:[.,]\d+)?)\s*"
    r"(?P<unit>mg|mcg|ug|g|ml|ui|iu|u|%)\b",
    re.IGNORECASE,
)
PACKAGE_SUFFIX = re.compile(
    r"\s+(?:#|n[°º]?|x)?\s*\d+\s+"
    r"(?:comprimidos?|tabletas?|capsulas?|sobres?|ampollas?|unidades?|dosis)\b.*$",
    re.IGNORECASE,
)
IGNORED_LINE = re.compile(
    r"\b(nombre|apellido|edad|direccion|avenida|av|clinica|centro|telefono|tel|doctor|doctora|dra|dr|"
    r"medico|diagnostico|hipertension|rut|firma|repetir|receta|paciente|fecha|fono|uso|usar|tomar|"
    r"aplicar|administrar|cada|horas?|dias?|ocasional|lunes|martes|miercoles|jueves|viernes)\b",
    re.IGNORECASE,
)


def medication_search_query(value: str) -> str:
    """Reduce una línea de receta a nombre y concentración para buscar catálogo."""
    cleaned = re.sub(r"^\s*(?:rp\/?\s*)?(?:\d+\s*[.)-]?\s*)?", "", value, flags=re.IGNORECASE)
    cleaned = " ".join(cleaned.split())
    dose = DOSE_PATTERN.search(cleaned)
    if not dose:
        return PACKAGE_SUFFIX.sub("", cleaned).strip()
    name = re.sub(r"(?:\(\s*\d+\s*\)|#\s*\d+)\s*$", "", cleaned[:dose.start()])
    name = re.sub(r"[^A-Za-zÁÉÍÓÚÑáéíóúñ -]+$", "", name).strip()
    name = re.split(r"\b(?:tomar|usar|aplicar|administrar)\b", name, maxsplit=1, flags=re.IGNORECASE)[0].strip()
    number = dose.group("number")
    if re.fullmatch(r"\d{1,3}(?:[.\s]\d{3})+", number):
        number = re.sub(r"[.\s]", "", number)
    else:
        number = number.replace(",", ".")
    unit = dose.group("unit")
    if unit.casefold() in {"iu", "u"}:
        unit = "UI"
    normalized_dose = f"{number} {unit}"
    return f"{name} {normalized_dose}".strip()


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
        normalized_line = line.casefold().replace("á", "a").replace("é", "e").replace("í", "i").replace("ó", "o").replace("ú", "u")
        if IGNORED_LINE.search(normalized_line):
            continue
        match = MEDICINE_LINE.search(line)
        if not match:
            continue
        query = medication_search_query(line)
        if len(query) < 3:
            continue
        key = query.casefold()
        if key not in seen:
            results.append({"query": query, "source_line": line, "confidence": 0.6})
            seen.add(key)
    return results[:30]

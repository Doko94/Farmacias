from __future__ import annotations

import io
import re
from pathlib import Path

MAX_IMAGE_PIXELS = 25_000_000
MAX_PDF_PAGES = 10
ALLOWED_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg", ".webp"}


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
    path = Path(filename)
    suffix = path.suffix.casefold()
    if suffix not in ALLOWED_SUFFIXES:
        raise ValueError("Formato no soportado. Usa PDF, PNG, JPG, JPEG o WEBP")
    if Path(path.stem).suffix:
        raise ValueError("El nombre contiene una extension doble y fue rechazado")
    if suffix == ".pdf":
        if not content.startswith(b"%PDF-"):
            raise ValueError("El contenido no corresponde a un PDF valido")
        try:
            from pypdf import PdfReader
        except ImportError as exc:
            raise RuntimeError("Instala pypdf para procesar recetas PDF") from exc
        try:
            reader = PdfReader(io.BytesIO(content), strict=True)
            if reader.is_encrypted:
                raise ValueError("No se admiten PDF protegidos o cifrados")
            if not 1 <= len(reader.pages) <= MAX_PDF_PAGES:
                raise ValueError(f"El PDF debe contener entre 1 y {MAX_PDF_PAGES} paginas")
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("El PDF esta corrupto o no puede procesarse") from exc
        return "\n".join(page.extract_text() or "" for page in reader.pages), "pdf"
    if suffix in {".png", ".jpg", ".jpeg", ".webp"}:
        signatures = {
            ".png": content.startswith(b"\x89PNG\r\n\x1a\n"),
            ".jpg": content.startswith(b"\xff\xd8\xff"),
            ".jpeg": content.startswith(b"\xff\xd8\xff"),
            ".webp": len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP",
        }
        if not signatures[suffix]:
            raise ValueError("La firma del archivo no coincide con su formato")
        try:
            import pytesseract
            from PIL import Image, UnidentifiedImageError
        except ImportError as exc:
            raise RuntimeError("Instala pillow y pytesseract para procesar fotos") from exc
        try:
            with Image.open(io.BytesIO(content)) as image:
                image.verify()
            with Image.open(io.BytesIO(content)) as image:
                width, height = image.size
                if width <= 0 or height <= 0 or width * height > MAX_IMAGE_PIXELS:
                    raise ValueError("La imagen supera el limite seguro de 25 megapixeles")
                image.load()
                return pytesseract.image_to_string(image, lang="spa"), "ocr"
        except ValueError:
            raise
        except (UnidentifiedImageError, OSError) as exc:
            raise ValueError("La imagen esta corrupta o no puede procesarse") from exc
    raise ValueError("Formato no soportado")


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

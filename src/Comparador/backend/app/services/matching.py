from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher


STOPWORDS = {"de", "del", "la", "el", "con", "sin", "y", "x"}
SYNONYMS = {"acetaminofen": "paracetamol"}
DOSE_PATTERN = re.compile(r"(\d+(?:[.,]\d+)?)\s*(mg|mcg|ug|g|ml|%)\b", re.I)
PACKAGE_PATTERN = re.compile(
    r"\b(\d+)\s*(comprimidos?|comp(?:\.|rimidos?)?|tabletas?|capsulas?|"
    r"cápsulas?|sobres?|ampollas?|unidades?|dosis|parches?|ovulos?|óvulos?)\b",
    re.I,
)
FORM_ALIASES = {
    "comp": "comprimido", "comps": "comprimido", "comprimido": "comprimido",
    "comprimidos": "comprimido", "tableta": "tableta", "tabletas": "tableta",
    "capsula": "capsula", "capsulas": "capsula", "sobre": "sobre",
    "sobres": "sobre", "ampolla": "ampolla", "ampollas": "ampolla",
    "unidad": "unidad", "unidades": "unidad", "dosis": "dosis",
    "parche": "parche", "parches": "parche", "ovulo": "ovulo", "ovulos": "ovulo",
    "jarabe": "jarabe", "jarabes": "jarabe", "solucion": "solucion",
    "suspension": "suspension", "gotas": "gotas", "crema": "crema",
    "gel": "gel", "spray": "spray", "inhalador": "inhalador",
}
FORM_PATTERN = re.compile(
    r"\b(comprimidos?|comp|tabletas?|capsulas?|sobres?|ampollas?|parches?|"
    r"ovulos?|jarabes?|solucion|suspension|gotas|crema|gel|spray|inhalador)\b",
    re.I,
)
STRUCTURAL_TOKENS = {
    "mg", "mcg", "ug", "g", "ml", "comprimido", "comprimidos", "comp",
    "tableta", "tabletas", "capsula", "capsulas", "sobre", "sobres",
    "ampolla", "ampollas", "unidad", "unidades", "dosis", "parche",
    "parches", "ovulo", "ovulos", "recubierto", "recubiertos", "liberacion",
    "prolongada", "oral",
}


def normalize(value: str) -> str:
    value = "".join(
        char
        for char in unicodedata.normalize("NFD", value.casefold())
        if unicodedata.category(char) != "Mn"
    )
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return " ".join(
        SYNONYMS.get(part, part)
        for part in value.split()
        if part not in STOPWORDS
    )


def product_signature(value: str) -> dict[str, tuple]:
    plain = normalize(value)
    doses = []
    for number, unit in DOSE_PATTERN.findall(plain):
        amount = float(number.replace(",", "."))
        normalized_unit = unit.casefold()
        if normalized_unit == "g":
            amount *= 1000
            normalized_unit = "mg"
        elif normalized_unit == "ug":
            normalized_unit = "mcg"
        doses.append((amount, normalized_unit))
    packages = tuple(
        (int(number), FORM_ALIASES.get(normalize(form), normalize(form).rstrip("s")))
        for number, form in PACKAGE_PATTERN.findall(plain)
    )
    forms = tuple(dict.fromkeys(
        FORM_ALIASES.get(normalize(form), normalize(form).rstrip("s"))
        for form in FORM_PATTERN.findall(plain)
    ))
    return {"doses": tuple(doses), "packages": packages, "forms": forms}


def _token_close(requested: str, offered: str) -> bool:
    if requested == offered:
        return True
    if len(requested) < 5 or abs(len(requested) - len(offered)) > 1:
        return False
    return SequenceMatcher(None, requested, offered).ratio() >= 0.86


def structured_match(query: str, candidate: str) -> bool:
    requested = product_signature(query)
    offered = product_signature(candidate)
    if requested["doses"] and not all(dose in offered["doses"] for dose in requested["doses"]):
        return False
    requested_strengths = {
        dose for dose in requested["doses"] if dose[1] in {"mg", "mcg", "%"}
    }
    offered_strengths = {
        dose for dose in offered["doses"] if dose[1] in {"mg", "mcg", "%"}
    }
    if requested_strengths and not offered_strengths.issubset(requested_strengths):
        return False
    if requested["packages"] and not all(package in offered["packages"] for package in requested["packages"]):
        return False
    if requested["forms"] and not set(requested["forms"]).intersection(offered["forms"]):
        return False
    query_terms = {
        term for term in normalize(query).split()
        if not term.isdigit() and term not in STRUCTURAL_TOKENS
    }
    candidate_terms = set(normalize(candidate).split())
    if query_terms and not all(
        any(_token_close(term, candidate) for candidate in candidate_terms)
        for term in query_terms
    ):
        return False
    return True


def match_score(query: str, candidate: str) -> float:
    query_norm = normalize(query)
    candidate_norm = normalize(candidate)
    if not query_norm or not candidate_norm:
        return 0.0
    query_tokens = set(query_norm.split())
    candidate_tokens = set(candidate_norm.split())
    token_score = len(query_tokens & candidate_tokens) / len(query_tokens)
    phrase_bonus = 0.25 if query_norm in candidate_norm else 0.0
    fuzzy = SequenceMatcher(None, query_norm, candidate_norm).ratio() * 0.25
    return min(1.0, token_score * 0.65 + phrase_bonus + fuzzy)

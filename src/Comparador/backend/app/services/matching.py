from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher


STOPWORDS = {"de", "del", "la", "el", "con", "sin", "y", "x"}
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
}
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
    value = re.sub(r"(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])", " ", value)
    return " ".join(part for part in value.split() if part not in STOPWORDS)


def product_signature(value: str) -> dict[str, tuple]:
    plain = normalize(value)
    doses = tuple(
        (number.replace(",", "."), "mcg" if unit.casefold() == "ug" else unit.casefold())
        for number, unit in DOSE_PATTERN.findall(plain)
    )
    packages = tuple(
        (int(number), FORM_ALIASES.get(normalize(form), normalize(form).rstrip("s")))
        for number, form in PACKAGE_PATTERN.findall(plain)
    )
    return {"doses": doses, "packages": packages}


def structured_match(query: str, candidate: str) -> bool:
    requested = product_signature(query)
    offered = product_signature(candidate)
    if requested["doses"] and not all(dose in offered["doses"] for dose in requested["doses"]):
        return False
    if requested["packages"] and not all(package in offered["packages"] for package in requested["packages"]):
        return False
    query_terms = {
        term for term in normalize(query).split()
        if term not in STRUCTURAL_TOKENS
    }
    candidate_terms = set(normalize(candidate).split())
    if query_terms and not query_terms.issubset(candidate_terms):
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

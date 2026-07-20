from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher


STOPWORDS = {"de", "del", "la", "el", "con", "sin", "y", "x"}


def normalize(value: str) -> str:
    value = "".join(
        char
        for char in unicodedata.normalize("NFD", value.casefold())
        if unicodedata.category(char) != "Mn"
    )
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return " ".join(part for part in value.split() if part not in STOPWORDS)


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

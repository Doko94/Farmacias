from __future__ import annotations

import re

from pydantic import BaseModel, Field, field_validator


class TreatmentItem(BaseModel):
    query: str = Field(min_length=2, max_length=180)
    units_per_dose: float = Field(default=1, gt=0, le=100)
    doses_per_day: float = Field(default=1, gt=0, le=24)
    units_per_package: float = Field(default=30, gt=0, le=10_000)


class TreatmentRequest(BaseModel):
    items: list[TreatmentItem]
    days: int = Field(default=30, ge=1, le=366)
    region: str = "Tarapaca"
    commune: str = "Iquique"


class RecipeItem(BaseModel):
    query: str = Field(min_length=2)
    quantity: int = Field(default=1, ge=1, le=100)


class OptimizationRequest(BaseModel):
    items: list[RecipeItem]
    region: str = "Tarapaca"
    commune: str = "Iquique"
    shipping_costs: dict[str, int] = Field(default_factory=dict)
    pickup: bool = True
    minimum_split_savings: int = Field(default=2000, ge=0)
    max_pharmacies: int = Field(default=3, ge=1, le=4)


class AlertRequest(BaseModel):
    email: str = Field(min_length=6, max_length=120)
    query: str = Field(min_length=2, max_length=120)
    target_price: int | None = Field(default=None, gt=0)
    region: str = "Tarapaca"
    commune: str = "Iquique"

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        value = value.strip().lower()
        if any(character.isspace() for character in value) or value.count("@") != 1:
            raise ValueError("correo no válido")
        local, domain = value.rsplit("@", 1)
        if not local or len(local) > 64 or len(domain) > 63 or "." not in domain:
            raise ValueError("correo no válido")
        if local.startswith(".") or local.endswith(".") or ".." in value:
            raise ValueError("correo no válido")
        if not re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+", local):
            raise ValueError("correo no válido")
        labels = domain.split(".")
        if any(not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", label) for label in labels):
            raise ValueError("correo no válido")
        return value

    @field_validator("query")
    @classmethod
    def validate_query(cls, value: str) -> str:
        value = " ".join(value.split()).strip()
        if sum(character.isalpha() for character in value) < 2:
            raise ValueError("producto no válido")
        if any(len(token) > 50 for token in value.split()):
            raise ValueError("producto no válido")
        if any(ord(character) < 32 or character in "<>\\{}[]" for character in value):
            raise ValueError("producto no válido")
        if any(character * 8 in value.lower() for character in set(value.lower())):
            raise ValueError("producto no válido")
        return value

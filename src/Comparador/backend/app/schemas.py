from __future__ import annotations

from pydantic import BaseModel, Field


class TreatmentItem(BaseModel):
    query: str = Field(min_length=2)
    units_per_dose: float = Field(default=1, gt=0)
    doses_per_day: float = Field(default=1, gt=0)
    units_per_package: float = Field(default=30, gt=0)


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
    email: str
    query: str = Field(min_length=2)
    target_price: int | None = Field(default=None, gt=0)
    region: str = "Tarapaca"
    commune: str = "Iquique"

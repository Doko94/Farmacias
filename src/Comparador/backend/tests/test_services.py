from pathlib import Path

from app.schemas import OptimizationRequest, RecipeItem, TreatmentItem, TreatmentRequest
from app.services.catalog import Catalog
from app.services.optimizer import optimize_recipe
from app.services.treatments import calculate_monthly


FIXTURE = Path(__file__).with_name("fixture.csv")


def catalog() -> Catalog:
    return Catalog({"Farmacia A": FIXTURE, "Farmacia B": FIXTURE})


def test_monthly_cost():
    result = calculate_monthly(catalog(), TreatmentRequest(
        items=[TreatmentItem(query="paracetamol", units_per_package=10)], days=30
    ))
    assert result["items"][0]["packages"] == 3
    assert result["total"] > 0


def test_recipe_optimizer():
    result = optimize_recipe(catalog(), OptimizationRequest(
        items=[RecipeItem(query="paracetamol"), RecipeItem(query="ibuprofeno")]
    ))
    assert result["ok"] is True
    assert result["recommendation"]["total"] > 0

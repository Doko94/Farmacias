from app.services.matching import normalize, structured_match


def test_search_normalization_variants():
    assert normalize("  PARACETÁMOL  ") == "paracetamol"
    assert normalize("acetaminofén") == "paracetamol"
    assert structured_match("paracetmol 500 mg", "Paracetamol 500 mg 16 comprimidos")


def test_concentration_is_not_mixed():
    assert structured_match("paracetamol 500 mg", "Paracetamol 500 mg 16 comprimidos")
    assert not structured_match("paracetamol 500 mg", "Paracetamol 1 g 16 comprimidos")


def test_form_is_not_mixed():
    assert not structured_match("paracetamol 500 mg comprimidos", "Paracetamol 500 mg jarabe")


def test_exact_package_is_respected_when_requested():
    assert structured_match(
        "paracetamol 500 mg 16 comprimidos",
        "Paracetamol 500 mg 16 comprimidos",
    )
    assert not structured_match(
        "paracetamol 500 mg 16 comprimidos",
        "Paracetamol 500 mg 100 comprimidos",
    )

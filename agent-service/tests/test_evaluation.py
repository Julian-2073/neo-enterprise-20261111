from copy import deepcopy
from datetime import date, timedelta
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from neo_agent.engine import CalculationError, simulate, compare
from neo_agent.evaluation import (
    ASSUMPTION, BUSINESS_ID, METHODS, digest, evaluate, make_report, make_synthetic as raw_make_synthetic,
    normalize_envelope, predict, scenario_fixture as raw_scenario_fixture, scores, verify_scenarios,
)

from test_asof_backtest import published_fixture

def make_synthetic(): return published_fixture(raw_make_synthetic())
def scenario_fixture(): return published_fixture(raw_scenario_fixture())


def test_same_folds_and_raw_metrics_recalculate_independently():
    result = evaluate(make_synthetic())
    assert result["weeks"] == 24
    assert len(result["folds"]) == 4
    assert [(f["trainEnd"], f["testEnd"]) for f in result["folds"]] == [
        ("2026-05-31", "2026-06-28"), ("2026-06-28", "2026-07-26"),
        ("2026-07-26", "2026-08-23"), ("2026-08-23", "2026-09-20")]
    assert result["coldStartActualUnits"] > 0 and result["zeroActualCells"] > 0
    for method in METHODS:
        cells = [c for f in result["folds"] for c in f["cells"]]
        total = sum(c["actualUnits"] for c in cells)
        absolute = sum(abs(c["actualUnits"] - c["predictions"][method]) for c in cells)
        assert result["metrics"][method]["wape"] == absolute / total
        assert result["metrics"][method]["actualUnits"] == total
        assert result["metrics"][method]["maeUnits"] == absolute / len(cells)


def test_declared_four_week_cycle_with_hand_checked_predictions():
    assert predict([1, 4, 2, 5] * 2, "fourWeekMean") == [3] * 4
    assert predict([1, 4, 2, 5] * 2, "lastWeek") == [5] * 4
    assert predict([1, 4, 2, 5] * 2, "seasonalNaive4") == [1, 4, 2, 5]
    with pytest.raises(CalculationError):
        predict([1, 2, 3], "fourWeekMean")
    with pytest.raises(CalculationError):
        predict([1, 2, 3, 4], "autoTune")


def test_holdout_mutation_changes_labels_but_not_earlier_forecasts():
    env = make_synthetic()
    original = evaluate(env)["folds"][0]
    changed = deepcopy(env)
    for row in changed["facts"]:
        if row["kind"] == "orders" and row["fact"]["entry_type"] == "paid" and row["fact"]["business_date"] > "2026-05-31":
            row["fact"]["quantity"] *= 97
    mutated = evaluate(changed)["folds"][0]
    assert original["trainingHash"] == mutated["trainingHash"]
    assert [c["predictions"] for c in original["cells"]] == [c["predictions"] for c in mutated["cells"]]
    assert original["metrics"] != mutated["metrics"]


def test_future_only_series_does_not_change_existing_prefix_hash():
    env = make_synthetic()
    before = evaluate(env)["folds"][0]
    row = deepcopy(next(r for r in env["facts"] if r["kind"] == "orders"))
    row.update(id="sim-only-in-future", availableAt="2026-06-09T20:00:00+08:00")
    row["fact"].update(product_id="sim-future-product", sku_id="sim-future-sku", channel="sim-direct", business_date="2026-06-09")
    env["facts"].append(row)
    after = evaluate(env)["folds"][0]
    assert before["trainingHash"] == after["trainingHash"]
    assert all(all(v == 0 for v in c["predictions"].values()) for c in after["cells"] if c["skuId"] == "sim-future-sku")


def test_available_at_filters_late_training_not_heldout_labels():
    env = scenario_fixture()
    before = evaluate(env)["folds"][0]
    row = next(r for r in env["facts"] if r["kind"] == "orders" and r["fact"]["entry_type"] == "paid" and r["fact"]["business_date"] == "2026-05-26")
    row["availableAt"] = "2026-06-02T00:00:00+08:00"
    result = evaluate(env)
    assert result["status"] == "partially_evaluated"
    assert result["skippedFolds"][0]["trainEnd"] == before["trainEnd"]
    assert result["skippedFolds"][0]["reason"] == "training_observations_unavailable"
    assert row["id"] in result["skippedFolds"][0]["rowIds"]


def test_coverage_gap_refuses_zero_imputation_for_fold():
    env = make_synthetic()
    env["snapshot"]["coverage"] = [c for c in env["snapshot"]["coverage"] if c["kind"] != "orders" or c["end"] <= "2026-05-31"]
    result = evaluate(env)
    assert result["status"] == "insufficient_coverage"
    assert len(result["skippedFolds"]) == 4
    assert result["metrics"]["fourWeekMean"]["wape"] is None


def test_zero_denominator_uses_null_wape_and_retains_mae():
    result = scores([(0, 2), (0, 0)])
    assert result["wape"] is None and result["bias"] is None
    assert result["maeUnits"] == 1 and result["absoluteErrorUnits"] == 2


def test_no_paid_history_and_short_history_do_not_fabricate_forecasts():
    env = scenario_fixture()
    env["facts"] = [r for r in env["facts"] if r["kind"] != "orders"]
    assert evaluate(env)["status"] == "no_paid_series"
    with pytest.raises(CalculationError):
        simulate(env)
    env = scenario_fixture()
    env["snapshot"]["periodStart"] = "2026-07-06"
    assert evaluate(env)["status"] == "insufficient_history"


def test_generator_expected_money_and_units_not_engine_derived():
    env = make_synthetic()
    expected = env["evaluationMetadata"]["generatorExpected"]
    result = evaluate(env)
    paid = sum(r["fact"]["quantity"] for r in env["facts"] if r["kind"] == "orders" and r["fact"]["entry_type"] == "paid")
    assert paid == expected["paidUnits"]
    assert result["accountingObserved"]["paidRevenueCents"] == expected["paidRevenueCents"]
    assert result["accountingObserved"]["refundCents"] == expected["refundCents"]


def test_refund_change_does_not_change_unit_target():
    env = make_synthetic()
    before = evaluate(env)
    for row in env["facts"]:
        if row["kind"] == "orders" and row["fact"]["entry_type"] == "refund":
            row["fact"]["amount_cents"] *= 2
    after = evaluate(env)
    assert before["metrics"] == after["metrics"]
    assert after["accountingObserved"]["refundCents"] == before["accountingObserved"]["refundCents"] * 2


def test_independent_scenario_controls():
    checks = verify_scenarios()
    assert checks["passed"], json.dumps(checks, ensure_ascii=False)
    assert len(checks["cases"]) == 9


def test_zero_recent_history_retained_not_dropped():
    env = scenario_fixture()
    env["facts"] = [r for r in env["facts"] if r["kind"] != "orders" or r["fact"]["business_date"] <= "2026-08-23"]
    result = simulate(env)
    assert result["totals"]["units"] == 0
    assert result["totals"]["unmetUnits"] == 0
    assert result["totals"]["endingUnits"] == 10
    assert result["products"][0]["units"] == 0


def test_out_of_window_orders_cannot_discover_future_sku_or_price():
    env = scenario_fixture()
    baseline = simulate(env)
    row = deepcopy(env["facts"][0])
    row["id"] = "sim-future-leak"
    row["fact"].update(business_date="2026-10-01", product_id="sim-new", sku_id="sim-new", amount_cents=999999)
    env["facts"].append(row)
    result = simulate(env)
    assert result["totals"] == baseline["totals"]
    assert result["products"] == baseline["products"]


@pytest.mark.parametrize("mutation", ["futurePeriod", "negativeStock", "duplicateStock", "negativeArrival", "duplicateArrival", "ambiguousSku"])
def test_engine_rejects_bad_supply_or_scope(mutation):
    env = scenario_fixture()
    if mutation == "futurePeriod":
        env["snapshot"]["periodEnd"] = "2026-10-01"
    elif mutation == "negativeStock":
        env["snapshot"]["data"]["inventory"][0]["sellable_units"] = -1
    elif mutation == "duplicateStock":
        env["snapshot"]["data"]["inventory"] *= 2
    elif mutation in ("negativeArrival", "duplicateArrival"):
        env["domain"]["arrivals"] = [{"id": "sim-plan", "skuId": "sim-sku-1-1", "warehouseId": "sim-wh-1", "date": "2026-10-01", "units": -1 if mutation == "negativeArrival" else 1}]
        if mutation == "duplicateArrival":
            env["domain"]["arrivals"] *= 2
    else:
        row = deepcopy(env["facts"][0])
        row["id"] = "sim-ambiguous-sku"
        row["fact"]["product_id"] = "sim-product-2"
        env["facts"].append(row)
    with pytest.raises(CalculationError):
        simulate(env)


def test_missing_cost_or_spending_is_unknown_not_zero_margin():
    env = scenario_fixture()
    for row in env["facts"]:
        if row["kind"] == "orders":
            row["fact"]["variable_cost_cents"] = None
    assert simulate(env)["totals"]["contributionMarginCents"] is None
    env = scenario_fixture()
    env["snapshot"]["coverage"] = [c for c in env["snapshot"]["coverage"] if c["kind"] != "expenses"]
    assert simulate(env)["totals"]["spendCents"] is None


def test_sensitivity_is_not_a_probability_interval():
    result = compare(scenario_fixture(), {"adjustments": [{"productId": "sim-product-1", "conversionMultiplier": 1.2, "assumption": ASSUMPTION}]})
    assert result["intervalMeaning"] == "assumption_sensitivity_not_confidence_interval"
    assert "非概率区间" in result["sensitivity"]["method"]
    assert "confidence" not in result


def test_same_fixture_across_python_hash_seeds_is_byte_stable():
    script = "import json; from neo_agent.evaluation import make_synthetic; from neo_agent.engine import simulate; print(json.dumps(simulate(make_synthetic()),sort_keys=True,ensure_ascii=False))"
    results = []
    for seed in ("1", "919"):
        results.append(subprocess.check_output([sys.executable, "-c", script], env={**os.environ, "PYTHONHASHSEED": seed}, text=True))
    assert results[0] == results[1]


def test_repeat_report_hash_and_accounting_version_are_stable():
    env = make_synthetic()
    a, b = make_report(env), make_report(env)
    assert a == b
    assert a["calculationVersion"] == "scenario-v1.3"
    assert a["formalIngestionVerification"] == "not_performed_by_this_offline_tool"
    assert a["inputScenarioVerification"]["passed"]
    assert a["inputScenarioVerification"]["actualExecution"] is False


@pytest.mark.parametrize("bad", ["enterprise", "nature", "missingChannel", "negativeQuantity", "nanAmount", "conflict"])
def test_adapter_refuses_bad_or_real_inputs(bad):
    env = make_synthetic()
    if bad == "enterprise":
        env["snapshot"]["businessId"] = "neo-live-demo"
    elif bad == "nature":
        env["snapshot"]["dataNature"] = "business"
    elif bad == "missingChannel":
        env["facts"][0]["fact"]["channel"] = None
    elif bad == "negativeQuantity":
        env["facts"][0]["fact"]["quantity"] = -1
    elif bad == "nanAmount":
        env["facts"][0]["fact"]["amount_cents"] = float("nan")
    else:
        extra = deepcopy(env["facts"][0])
        extra["fact"]["quantity"] += 1
        env["facts"].append(extra)
    with pytest.raises(CalculationError):
        normalize_envelope(env)


def test_adapter_accepts_exported_envelope_and_exact_duplicate_once():
    env = make_synthetic()
    env["facts"].append(deepcopy(env["facts"][0]))
    normalized = normalize_envelope({"envelope": env})
    assert normalized["evaluationMetadata"]["exactDuplicateRowsRemoved"] == 1
    assert len(normalized["facts"]) == len(env["facts"]) - 1


def test_late_labels_and_timezone_are_explicit():
    env = make_synthetic()
    env["facts"][0]["availableAt"] = "2026-10-05T00:00:00+08:00"
    assert evaluate(env)["availability"]["lateLabelRowsExcluded"] == 1
    row = env["facts"][1]
    row["fact"].pop("business_date")
    row["fact"]["occurred_at"] = "2026-04-06T17:00:00Z"
    assert next(r for r in normalize_envelope(env)["facts"] if r["id"] == row["id"])["fact"]["business_date"] == "2026-04-07"

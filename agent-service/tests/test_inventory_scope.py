"""FORECAST-INV-01: known stock is independent of forecastable sales history."""
from copy import deepcopy
from datetime import date, timedelta

import pytest

from neo_agent.engine import CalculationError, compare, simulate
from test_engine import fixture, A


def unknown_stock(env, sku="S-new", product="P-new", units=70, cost=70000):
    env["domain"].setdefault("products", []).append({"id": product})
    env["snapshot"]["data"]["inventory"].append({"product_id": product, "sku_id": sku,
        "warehouse_id": "W1", "sellable_units": units, "inventory_cost_cents": cost})
    return env


def tomorrow(env):
    return (date.fromisoformat(env["snapshot"]["asOf"]) + timedelta(days=1)).isoformat()


@pytest.mark.parametrize("registered", [True, False])
def test_new_product_stock_and_book_value_retained_without_creating_sales(registered):
    env = fixture()
    baseline = simulate(env)
    unknown_stock(env)
    if not registered:
        env["domain"]["products"] = []
    result = simulate(env)
    assert result["totals"]["units"] == baseline["totals"]["units"]
    assert result["totals"]["endingUnits"] == baseline["totals"]["endingUnits"] + 70
    assert result["totals"]["endingInventoryCostCents"] == baseline["totals"]["endingInventoryCostCents"] + 70000
    assert next(r for r in result["endingInventory"] if r["skuId"] == "S-new") == {
        "skuId": "S-new", "warehouseId": "W1", "units": 70, "demandStatus": "unestimated"}
    coverage = result["forecastCoverage"]
    assert coverage["status"] == "partial"
    assert coverage["salesTotalsScope"] == "forecasted_skus_only"
    assert coverage["unestimatedSkuIds"] == ["S-new"]
    assert coverage["unestimatedEndingUnits"] == 70
    assert coverage["unestimatedEndingInventoryCostCents"] == 70000
    assert result["totals"]["contributionMarginCents"] is None
    assert all(d["contributionMarginCents"] is None for d in result["daily"])
    assert all(w["contributionMarginCents"] is None for w in result["weeks"])
    assert "需求未估计，不等于零需求" in result["limitations"][0]


def test_new_sku_of_existing_product_is_partial_even_if_product_has_sales():
    env = unknown_stock(fixture(), product="P1")
    result = simulate(env)
    assert result["forecastCoverage"]["unestimatedSkuIds"] == ["S-new"]
    assert result["forecastCoverage"]["unestimatedProductIds"] == []
    assert result["totals"]["units"] == 56
    assert result["totals"]["endingUnits"] == 1014
    assert result["forecastCoverage"]["status"] == "partial"


@pytest.mark.parametrize("units,cost,expected", [(70, None, None), (70, 0, 0), (0, None, 0)])
def test_unknown_cost_not_filled_with_zero_and_zero_stock_has_no_value(units, cost, expected):
    result = simulate(unknown_stock(fixture(), units=units, cost=cost))
    coverage = result["forecastCoverage"]
    assert coverage["unestimatedEndingUnits"] == units
    assert coverage["unestimatedEndingInventoryCostCents"] == expected
    assert coverage["inventoryValuationComplete"] == (expected is not None)
    if expected is None:
        assert result["totals"]["endingInventoryCostCents"] is None


def test_new_sku_domain_arrival_and_scenario_arrival_are_counted_once():
    env = unknown_stock(fixture())
    env["domain"]["arrivals"] = [{"id": "new-plan", "skuId": "S-new", "warehouseId": "W2", "date": tomorrow(env), "units": 20}]
    baseline = simulate(env)
    assert baseline["forecastCoverage"]["unestimatedEndingUnits"] == 90
    assert baseline["forecastCoverage"]["unestimatedEndingInventoryCostCents"] == 90000
    adjusted = compare(env, {"arrivals": [{"skuId": "S-new", "warehouseId": "W2", "date": tomorrow(env),
                                        "units": 30, "replacesPlanId": "new-plan", "assumption": A}]})
    assert adjusted["forecastCoverage"]["unestimatedEndingUnits"] == 100
    assert adjusted["forecastCoverage"]["unestimatedEndingInventoryCostCents"] == 100000
    assert adjusted["delta"]["units"] == 0
    assert adjusted["delta"]["endingUnits"] == 10
    assert adjusted["delta"]["contributionMarginCents"] is None


def test_new_sku_arrival_does_not_use_future_or_unknown_unit_cost():
    env = unknown_stock(fixture(), cost=None)
    result = simulate(env, {"arrivals": [{"skuId": "S-new", "warehouseId": "W2", "date": tomorrow(env), "units": 20, "assumption": A}]})
    assert result["forecastCoverage"]["unestimatedEndingUnits"] == 90
    assert result["forecastCoverage"]["unestimatedEndingInventoryCostCents"] is None
    assert result["totals"]["endingInventoryCostCents"] is None


def test_new_sku_cross_warehouse_transfer_preserves_units_and_value():
    env = unknown_stock(fixture())
    env["snapshot"]["data"]["inventory"].append({"product_id": "P-new", "sku_id": "S-new", "warehouse_id": "W2", "sellable_units": 10, "inventory_cost_cents": 20000})
    baseline = simulate(env)
    result = simulate(env, {"transfers": [{"skuId": "S-new", "fromWarehouse": "W1", "toWarehouse": "W2", "date": tomorrow(env), "units": 30, "assumption": A}]})
    assert result["totals"] == baseline["totals"]
    assert result["forecastCoverage"]["unestimatedEndingUnits"] == 80
    assert result["forecastCoverage"]["unestimatedEndingInventoryCostCents"] == 90000
    assert {r["warehouseId"]: r["units"] for r in result["endingInventory"] if r["skuId"] == "S-new"} == {"W1": 40, "W2": 40}
    with pytest.raises(CalculationError, match="调拨超过"):
        simulate(env, {"transfers": [{"skuId": "S-new", "fromWarehouse": "W1", "toWarehouse": "W2", "date": tomorrow(env), "units": 71, "assumption": A}]})


def test_zero_recent_sales_with_history_is_observed_zero_not_unestimated():
    env = fixture()
    end = date.fromisoformat(env["snapshot"]["periodEnd"])
    recent_start = (end - timedelta(days=27)).isoformat()
    env["facts"] = [r for r in env["facts"] if r["kind"] != "orders" or r["fact"]["business_date"] < recent_start]
    result = simulate(env)
    assert result["totals"]["units"] == 0
    assert result["forecastCoverage"]["unestimatedSkuIds"] == []
    assert result["forecastCoverage"]["status"] == "complete_for_observed_sales"


def test_no_forecastable_history_is_still_explicitly_unavailable():
    env = unknown_stock(fixture())
    env["facts"] = [r for r in env["facts"] if r["kind"] != "orders"]
    with pytest.raises(CalculationError, match="没有可预测"):
        simulate(env)

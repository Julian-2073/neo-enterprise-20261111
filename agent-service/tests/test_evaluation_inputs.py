from copy import deepcopy
import hashlib
import json

import pytest

from neo_agent.engine import CalculationError
from neo_agent.evaluation import BUSINESS_ID, MARKER
from neo_agent.evaluation_inputs import load_synthetic_package


def package(tmp_path, change=None):
    data = {
        "orders": [{"source_record_id": "sim-o1", "product_id": "sim-p1", "sku_id": "sim-s1", "channel": "sim-c1", "entry_type": "paid", "occurred_at": "2026-09-01T12:00:00+08:00", "quantity": 1, "amount_cents": 10000}],
        "expenses": [], "products": [], "product_roles": [],
        "inventory": [
            {"source_record_id": "sim-i1", "sku_id": "sim-s1", "warehouse_id": "sim-w1", "occurred_at": "2026-09-01T23:00:00+08:00", "sellable_units": 7},
            {"source_record_id": "sim-i2", "sku_id": "sim-s1", "warehouse_id": "sim-w1", "occurred_at": "2026-09-20T23:00:00+08:00", "sellable_units": 3},
            {"source_record_id": "sim-i3", "sku_id": "sim-s1", "warehouse_id": "sim-w1", "occurred_at": "2026-09-25T23:00:00+08:00", "sellable_units": 100}],
        "arrival_plan_versions": [
            {"plan_id": "sim-plan", "version": 1, "known_at": "2026-09-01T07:00:00+08:00", "planned_eta": "2026-09-28", "sku_id": "sim-s1", "warehouse_id": "sim-w1", "units": 20, "status": "planned"},
            {"plan_id": "sim-plan", "version": 2, "known_at": "2026-09-24T07:00:00+08:00", "planned_eta": "2026-10-01", "sku_id": "sim-s1", "warehouse_id": "sim-w1", "units": 20, "status": "delayed"},
            {"plan_id": "sim-plan", "version": 3, "known_at": "2026-09-25T07:00:00+08:00", "planned_eta": "2026-10-10", "sku_id": "sim-s1", "warehouse_id": "sim-w1", "units": 20, "status": "delayed"}],
        "arrival_receipts": [{"plan_id": "sim-plan", "known_at": "2026-09-23T07:00:00+08:00", "received_at": "2026-09-23T06:00:00+08:00", "units": 5}]}
    if change:
        change(data)
    raw = json.dumps(data).encode()
    (tmp_path / "normal").mkdir()
    (tmp_path / "normal/source-records.json").write_bytes(raw)
    manifest = {"businessId": BUSINESS_ID, "businessName": "NEO 隔离模拟企业", "dataNature": "demo", "dataLabel": MARKER,
                "periodStart": "2026-04-06", "periodEnd": "2026-09-20", "asOf": "2026-09-24", "importBatches": [],
                "files": {"normal/source-records.json": {"sha256": hashlib.sha256(raw).hexdigest()}}}
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    return tmp_path


def test_sibling_adapter_latest_inventory_and_known_plan_without_receipt_double_count(tmp_path):
    env = load_synthetic_package(package(tmp_path))
    assert env["snapshot"]["data"]["inventory"][0]["sellable_units"] == 3
    assert len(env["snapshot"]["data"]["inventory"]) == 1
    assert env["domain"]["arrivals"] == [{"id": "sim-plan", "version": 2, "date": "2026-10-01", "units": 15,
                                         "skuId": "sim-s1", "warehouseId": "sim-w1", "knownAt": "2026-09-24T07:00:00+08:00"}]
    assert "availableAt" not in env["facts"][0]
    assert env["evaluationMetadata"]["formalIngestionVerified"] is False


def test_manifest_content_drift_rejected(tmp_path):
    package(tmp_path)
    (tmp_path / "normal/source-records.json").write_text("{}")
    with pytest.raises(CalculationError, match="指纹"):
        load_synthetic_package(tmp_path)


def test_overdue_plan_not_assumed_received(tmp_path):
    def change(data):
        data["arrival_plan_versions"][1]["planned_eta"] = "2026-09-23"
    env = load_synthetic_package(package(tmp_path, change))
    assert env["domain"]["arrivals"] == []
    assert env["evaluationMetadata"]["overdueArrivalPlansNotCounted"] == ["sim-plan"]


def test_cancellation_and_future_receipts_do_not_leak_into_stock(tmp_path):
    def change(data):
        data["arrival_plan_versions"][1]["status"] = "cancelled"
        data["arrival_receipts"][0]["received_at"] = "2026-09-25T06:00:00+08:00"
    env = load_synthetic_package(package(tmp_path, change))
    assert env["domain"]["arrivals"] == []
    assert env["snapshot"]["data"]["inventory"][0]["sellable_units"] == 3


def test_available_future_receipt_excluded_but_known_plan_retained(tmp_path):
    def change(data):
        data["arrival_receipts"][0]["received_at"] = "2026-09-25T06:00:00+08:00"
    env = load_synthetic_package(package(tmp_path, change))
    assert env["domain"]["arrivals"][0]["units"] == 20

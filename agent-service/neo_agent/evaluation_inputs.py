"""Read-only adapter for the sibling synthetic-data package, not a DB importer."""
from collections import defaultdict
from pathlib import Path
import hashlib
import json

from .engine import CalculationError
from .evaluation import BUSINESS_ID, MARKER, business_day, end_of_day, instant, normalize_envelope


def load_synthetic_package(directory):
    base = Path(directory).resolve()
    manifest_path = base / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    if (manifest.get("businessId"), manifest.get("dataNature"), manifest.get("dataLabel")) != (BUSINESS_ID, "demo", MARKER):
        raise CalculationError("数据包必须为授权隔离模拟企业的 SYNTHETIC_DEMO")
    relative = "normal/source-records.json"
    raw_path = (base / relative).resolve()
    if not raw_path.is_relative_to(base):
        raise CalculationError("数据包引用越界")
    raw = raw_path.read_bytes()
    expected = manifest.get("files", {}).get(relative, {}).get("sha256")
    fingerprint = hashlib.sha256(raw).hexdigest()
    if not expected or expected != fingerprint:
        raise CalculationError("source-records 与数据工作线 manifest 指纹不一致")
    records = json.loads(raw)
    origin = business_day({"business_date": manifest["asOf"]})
    knowledge = end_of_day(origin)
    facts = []
    for kind in ("orders", "expenses"):
        for row in records.get(kind, []):
            fact = dict(row)
            fact["business_date"] = business_day(fact).isoformat()
            item = {"id": fact["source_record_id"], "kind": kind, "fact": fact}
            # Do not invent import availability from the transaction timestamp.
            if row.get("known_at"):
                item["availableAt"] = row["known_at"]
            facts.append(item)
    # Build one stock point per SKU/warehouse, never sum historical stock snapshots.
    inventory = {}
    for row in records.get("inventory", []):
        d = business_day(row)
        if d > origin or row.get("known_at") and instant(row["known_at"]) > knowledge:
            continue
        key = (row["sku_id"], row["warehouse_id"])
        rank = str(row.get("occurred_at", d.isoformat()))
        if key in inventory and rank == inventory[key][0] and row != inventory[key][1]:
            raise CalculationError("同 SKU/仓库/时点库存内容冲突")
        if key not in inventory or rank > inventory[key][0]:
            inventory[key] = (rank, row)
    versions = {}
    for row in records.get("arrival_plan_versions", []):
        if row.get("business_id", BUSINESS_ID) != BUSINESS_ID or row.get("data_nature", MARKER) != MARKER:
            raise CalculationError("到货计划包含跨范围记录")
        if instant(row["known_at"]) > knowledge:
            continue
        ident, version = row["plan_id"], row["version"]
        if ident in versions and version == versions[ident]["version"] and row != versions[ident]:
            raise CalculationError("到货计划同版本内容冲突")
        if ident not in versions or version > versions[ident]["version"]:
            versions[ident] = row
    received = defaultdict(int)
    for row in records.get("arrival_receipts", []):
        if instant(row["known_at"]) <= knowledge and instant(row["received_at"]) <= knowledge:
            received[row["plan_id"]] += row["units"]
    arrivals, overdue = [], []
    for ident, row in sorted(versions.items()):
        if row["status"] not in ("planned", "delayed"):
            continue
        units = max(0, row["units"] - received[ident])
        if not units:
            continue
        if row["planned_eta"] <= origin.isoformat():
            overdue.append(ident)
            continue
        arrivals.append({"id": ident, "skuId": row["sku_id"], "warehouseId": row["warehouse_id"],
                         "date": row["planned_eta"], "units": units, "version": row["version"],
                         "knownAt": row["known_at"]})
    coverage = [{"kind": b["kind"], "sourceId": b["sourceName"], "start": b["coverageStart"],
                 "end": b["coverageEnd"]} for b in manifest.get("importBatches", []) if b["kind"] in ("orders", "expenses")]
    env = {"marker": MARKER, "snapshot": {"id": "sim-source-adapter-" + fingerprint[:16],
           "businessId": BUSINESS_ID, "businessName": manifest["businessName"], "dataNature": "demo",
           "periodStart": manifest["periodStart"], "periodEnd": manifest["periodEnd"], "asOf": manifest["asOf"],
           "timezone": "Asia/Shanghai", "coverage": coverage, "evidenceIds": {}, "limitations": [
               "SYNTHETIC_DEMO：原始合成包只读适配，未证明正式导入/质量/提交路径。",
               "订单未提供 known_at 时不构造可用时间；历史迟到资料泄漏仍需上游接口核验。",
               "到货使用截至时点已知最新版本，已收货部分不重复计入；逾期未收货不自动假定已到。"],
           "data": {"inventory": [dict(r) for _, r in sorted(inventory.values(), key=lambda x: (x[1]["sku_id"], x[1]["warehouse_id"]))]}},
           "facts": facts, "domain": {"products": records.get("products", []), "roles": records.get("product_roles", []),
                                      "arrivals": arrivals}, "evaluationMetadata": {
               "adapterVersion": "synthetic-source-records-v1", "sourceRecordsSha256": fingerprint,
               "sourceManifestSha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
               "seasonMeaning": "固定四周经营节奏压力对照；本合成数据未声明四周重复季节性，不据此推荐模型",
               "knownAt": knowledge.isoformat(), "overdueArrivalPlansNotCounted": overdue,
               "formalIngestionVerified": False}}
    return normalize_envelope(env)

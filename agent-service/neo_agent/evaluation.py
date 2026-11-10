"""Offline forecast evaluation; no DB, providers, agent loops or execution side effects.

Input is an exported immutable engine envelope. Labels may use held-out observations;
predictors only receive the prefix available at each forecast origin.
"""
from collections import defaultdict
from copy import deepcopy
from datetime import date, datetime, time, timedelta
from pathlib import Path
from random import Random
from statistics import mean
from zoneinfo import ZoneInfo
import hashlib
import json
import math

from .engine import CALCULATION_VERSION, CalculationError, compare, simulate

EVALUATION_VERSION = "forecast-evaluation-v2"
BUSINESS_ID = "neo-sim-acceptance-20261004"
MARKER = "SYNTHETIC_DEMO"
TZ = ZoneInfo("Asia/Shanghai")
METHODS = ("fourWeekMean", "lastWeek", "seasonalNaive4")


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     allow_nan=False, separators=(",", ":")).encode()).hexdigest()


def instant(value):
    result = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise CalculationError("availableAt/knownAt 必须包含时区")
    return result.astimezone(TZ)


def end_of_day(value):
    return datetime.combine(value, time.max, TZ)


def business_day(fact):
    if fact.get("business_date"):
        return date.fromisoformat(fact["business_date"])
    stamp = str(fact["occurred_at"])
    return instant(stamp).date() if "T" in stamp else date.fromisoformat(stamp)


def number(value, name, integer=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise CalculationError(f"{name} 须为非负有限数值")
    if integer and (int(value) != value or value > 9007199254740991):
        raise CalculationError(f"{name} 须为安全整数")
    return value


def normalize_envelope(value):
    """Accept direct engine input, {envelope: ...}, or a saved job's envelope.

    This is an evaluator adapter, not a replacement ingestion/quality pipeline.
    It refuses other enterprises/natures, conflicts, ambiguous dates and quantities.
    """
    env = deepcopy(value.get("envelope", value))
    if "snapshot" not in env or "facts" not in env:
        raise CalculationError("需要包含 snapshot/facts/domain 的引擎输入封装")
    s = env["snapshot"]
    if s.get("businessId") != BUSINESS_ID or s.get("dataNature") != "demo":
        raise CalculationError("独立验收仅接受 neo-sim-acceptance-20261004 的 demo 输入")
    for key in ("periodStart", "periodEnd", "asOf"):
        date.fromisoformat(s[key])
    if s["periodEnd"] > s["asOf"] or s["periodStart"] > s["periodEnd"]:
        raise CalculationError("统计期与截至时间不一致")
    unique = {}
    for row in env["facts"]:
        if row.get("businessId", BUSINESS_ID) != BUSINESS_ID or row.get("dataNature", "demo") != "demo":
            raise CalculationError("事实含跨企业或非 demo 引用")
        if not row.get("id") or not isinstance(row.get("fact"), dict):
            raise CalculationError("事实必须具有稳定 id 与 fact")
        key = row["id"]
        f = row["fact"]
        if f.get("business_id", BUSINESS_ID) != BUSINESS_ID or f.get("data_nature", MARKER) not in (MARKER, "demo"):
            raise CalculationError("事实内容含跨企业或非 demo 引用")
        f["business_date"] = business_day(f).isoformat()
        if key in unique and unique[key] != row:
            raise CalculationError("同一事实 id 内容冲突")
        if row["kind"] == "orders":
            if not all(f.get(k) for k in ("product_id", "sku_id", "channel")):
                raise CalculationError("订单商品/SKU/渠道缺失，不能当作零需求")
            if f.get("entry_type") not in ("paid", "refund"):
                raise CalculationError("订单必须区分 paid/refund")
            if number(f.get("quantity"), "quantity", integer=True) <= 0:
                raise CalculationError("订单件数须为正")
            number(f.get("amount_cents"), "amount_cents", integer=True)
            if f.get("variable_cost_cents") is not None:
                number(f["variable_cost_cents"], "variable_cost_cents", integer=True)
        unique[key] = row
    env["facts"] = sorted(unique.values(), key=lambda row: str(row["id"]))
    env.setdefault("domain", {"arrivals": []})
    # Future effective dates are allowed only for arrival plans, not realized facts.
    env.setdefault("evaluationMetadata", {})
    env["evaluationMetadata"]["exactDuplicateRowsRemoved"] = env["evaluationMetadata"].get("exactDuplicateRowsRemoved", 0) + len(value.get("envelope", value)["facts"]) - len(unique)
    return env


def complete_weeks(snapshot):
    start, end = date.fromisoformat(snapshot["periodStart"]), date.fromisoformat(snapshot["periodEnd"])
    cursor = start + timedelta(days=(7 - start.weekday()) % 7)
    result = []
    while cursor + timedelta(days=6) <= end:
        result.append(cursor)
        cursor += timedelta(days=7)
    return result


def covered(snapshot, start, end):
    """Every declared orders source must cover a window before absence means zero."""
    records = [r for r in snapshot.get("coverage", []) if r["kind"] == "orders"]
    sources = {r["sourceId"] for r in records}
    if not sources:
        return False
    for source in sources:
        cursor = start
        for left, right in sorted((date.fromisoformat(r["start"]), date.fromisoformat(r["end"]))
                                  for r in records if r["sourceId"] == source):
            if left <= cursor <= right:
                cursor = right + timedelta(days=1)
        if cursor <= end:
            return False
    return True


def predict(prefix, method):
    if len(prefix) < 4:
        raise CalculationError("需要至少四个已观察完整周")
    if method == "fourWeekMean":
        return [mean(prefix[-4:])] * 4
    if method == "lastWeek":
        return [prefix[-1]] * 4
    if method == "seasonalNaive4":
        return list(prefix[-4:])
    raise CalculationError("未知对照方法")


def scores(pairs):
    actual = sum(a for a, _ in pairs)
    absolute = sum(abs(p - a) for a, p in pairs)
    signed = sum(p - a for a, p in pairs)
    return {"observations": len(pairs), "actualUnits": round(actual, 6),
            "predictedUnits": round(sum(p for _, p in pairs), 6),
            "absoluteErrorUnits": round(absolute, 6),
            "signedErrorUnits": round(signed, 6),
            "maeUnits": absolute / len(pairs) if pairs else None,
            "wape": absolute / actual if actual else None,
            "bias": signed / actual if actual else None}


def evaluate(env):
    from .backtesting import evaluate_envelope
    return evaluate_envelope(normalize_envelope(env))


def make_synthetic(seed=20261004):
    """Small, frozen 24-week fixture; generator arithmetic is independent of engine."""
    rng = Random(seed)
    start = date(2026, 4, 6)
    end = start + timedelta(days=24 * 7 - 1)
    rows, inventory, expected = [], [], {"paidUnits": 0, "paidRevenueCents": 0, "refundCents": 0}
    for product in range(1, 5):
        sku_count = 2 if product == 1 else 1
        for sku_index in range(1, sku_count + 1):
            sku = f"sim-sku-{product}-{sku_index}"
            for warehouse in ("sim-wh-1", "sim-wh-2"):
                stock = 12 if product == 1 else 60
                inventory.append({"product_id": f"sim-product-{product}", "sku_id": sku,
                                  "warehouse_id": warehouse, "sellable_units": stock,
                                  "inventory_cost_cents": stock * product * 3000, "in_transit_units": 0})
            for channel in ("sim-direct", "sim-market"):
                for i in range(24):
                    # Period and shapes are declared before any comparison is run.
                    if product == 1:
                        q = (8, 12, 6, 14)[i % 4] + i // 8 + rng.randrange(3)
                    elif product == 2:
                        q = 6 + rng.randrange(3)
                    elif product == 3:
                        q = 4 + rng.randrange(2) if i < 16 else 0
                    else:
                        q = 0 if i < 18 else 3 + (i - 18) + rng.randrange(2)
                    when = start + timedelta(days=7 * i + 1)
                    if q:
                        price = product * 10000
                        f = {"source_record_id": f"sim-paid-{product}-{sku_index}-{channel}-{i}",
                             "order_id": f"sim-order-{product}-{sku_index}-{channel}-{i}", "order_line_id": "sim-line-1",
                             "product_id": f"sim-product-{product}", "sku_id": sku, "channel": channel,
                             "entry_type": "paid", "business_date": when.isoformat(), "quantity": q,
                             "amount_cents": q * price, "variable_cost_cents": q * product * 3000}
                        rows.append({"id": f["source_record_id"], "kind": "orders", "fact": f,
                                     "availableAt": f"{when.isoformat()}T20:00:00+08:00"})
                        expected["paidUnits"] += q
                        expected["paidRevenueCents"] += q * price
                        if i % 7 == 6:
                            refund = {**f, "source_record_id": f"sim-refund-{product}-{sku_index}-{channel}-{i}",
                                      "entry_type": "refund", "quantity": 1, "amount_cents": price,
                                      "variable_cost_cents": product * 3000}
                            rows.append({"id": refund["source_record_id"], "kind": "orders", "fact": refund,
                                         "availableAt": f"{when.isoformat()}T21:00:00+08:00"})
                            expected["refundCents"] += price
    for product in range(1, 5):
        for channel in ("sim-direct", "sim-market"):
            for i in range(24):
                d = (start + timedelta(days=7 * i)).isoformat()
                rows.append({"id": f"sim-expense-{product}-{channel}-{i}", "kind": "expenses",
                             "availableAt": f"{d}T21:00:00+08:00", "fact": {"business_date": d,
                             "product_id": f"sim-product-{product}", "channel": channel, "amount_cents": 7000}})
    return {"marker": MARKER, "snapshot": {"id": f"sim-eval-24w-seed-{seed}", "businessId": BUSINESS_ID,
            "businessName": "NEO 隔离模拟企业", "dataNature": "demo", "asOf": "2026-09-24",
            "periodStart": start.isoformat(), "periodEnd": end.isoformat(), "timezone": "Asia/Shanghai",
            "limitations": [MARKER], "evidenceIds": {}, "coverage": [
                {"kind": k, "sourceId": "sim-source-" + k, "start": start.isoformat(), "end": end.isoformat()}
                for k in ("orders", "expenses")], "data": {"inventory": inventory}}, "facts": rows,
            "domain": {"products": [{"id": f"sim-product-{p}", "roleId": f"sim-role-{min(p, 3)}"} for p in range(1, 5)],
                       "roles": [{"id": f"sim-role-{r}"} for r in range(1, 4)], "arrivals": [{
                           "id": "sim-arrival-1", "skuId": "sim-sku-1-1", "warehouseId": "sim-wh-1",
                           "date": "2026-10-04", "units": 40}]},
            "evaluationMetadata": {"seed": seed, "knownAt": "2026-09-24T23:59:59+08:00",
                                   "seasonMeaning": "预先定义的每四周经营周期，仅为合成方法对照；非年度季节性",
                                   "generatorExpected": expected}}


def scenario_fixture():
    """Hand-checkable fixture: 2 channels × 7 paid units/week, 24 complete weeks.

    Forecast: 56 dispatched units without stock limits; price 10000/unit, cost 5000,
    spending 14000/week. Refunds: 10000/140000 = 1/14 of gross revenue each week.
    """
    env = make_synthetic()
    env["facts"] = []
    start = date(2026, 4, 6)
    for i in range(24):
        d = (start + timedelta(days=7 * i + 1)).isoformat()
        for channel in ("sim-direct", "sim-market"):
            f = {"product_id": "sim-product-1", "sku_id": "sim-sku-1-1", "channel": channel,
                 "business_date": d, "entry_type": "paid", "quantity": 7,
                 "amount_cents": 70000, "variable_cost_cents": 35000}
            env["facts"].append({"id": f"sim-control-{i}-{channel}", "kind": "orders", "fact": f})
            env["facts"].append({"id": f"sim-control-expense-{i}-{channel}", "kind": "expenses",
                                 "fact": {"product_id": "sim-product-1", "channel": channel,
                                          "business_date": d, "amount_cents": 7000}})
        env["facts"].append({"id": f"sim-control-refund-{i}", "kind": "orders", "fact": {
            **f, "quantity": 1, "entry_type": "refund", "amount_cents": 10000, "variable_cost_cents": 5000}})
    env["snapshot"]["id"] = "sim-scenario-control-24w"
    env["snapshot"]["data"]["inventory"] = [{"product_id": "sim-product-1", "sku_id": "sim-sku-1-1",
        "warehouse_id": "sim-wh-1", "sellable_units": 10, "inventory_cost_cents": 50000}]
    env["domain"] = {"arrivals": []}
    env["evaluationMetadata"] = {"seasonMeaning": "constant control", "independentDemandUnits": 56}
    return env


ASSUMPTION = {"source": "synthetic", "note": "SYNTHETIC_DEMO 核验参数，非执行指令", "confirmed": False}


def verify_scenarios():
    """Expected values are arithmetic controls, not copied engine predictions."""
    env = scenario_fixture()
    baseline = simulate(env)
    cases = []
    def check(name, result, expected, tolerances=None):
        tolerances = tolerances or {}
        comparisons = {}
        for key, value in expected.items():
            observed = result["totals"][key]
            tolerance = tolerances.get(key, 1e-4)
            passed = observed is None if value is None else observed is not None and abs(observed - value) <= tolerance
            comparisons[key] = {"expected": value, "observed": observed, "tolerance": tolerance, "passed": passed}
        passed = all(c["passed"] for c in comparisons.values())
        cases.append({"case": name, "passed": passed, "comparisons": comparisons,
                      "inputHash": result["inputHash"], "resultHash": digest(result)})
    check("stock_cap_and_unfulfilled_units", baseline, {"units": 10, "unmetUnits": 46, "endingUnits": 0})
    early = {"arrivals": [{"skuId": "sim-sku-1-1", "warehouseId": "sim-wh-1", "date": "2026-09-25",
                           "units": 20, "assumption": ASSUMPTION}]}
    late = deepcopy(early)
    late["arrivals"][0]["date"] = "2026-10-16"
    check("arrival_before_demand", compare(env, early), {"units": 30, "unmetUnits": 26, "endingUnits": 0})
    check("late_arrival_only_remaining_days", compare(env, late), {"units": 24, "unmetUnits": 32, "endingUnits": 6})
    more = deepcopy(early)
    more["arrivals"][0]["units"] = 100
    check("stock_does_not_create_demand", compare(env, more), {"units": 56, "unmetUnits": 0, "endingUnits": 54})
    budget = {"adjustments": [{"productId": "sim-product-1", "budgetMultiplier": 2, "budgetResponse": 1,
                               "assumption": ASSUMPTION}]}
    check("budget_under_stock_cap", compare(env, budget), {"units": 10, "unmetUnits": 102, "spendCents": 112000})
    extra = compare(env, {"extraCostCents": 12345, "extraCostAssumption": ASSUMPTION})
    check("extra_cost_deducted_once", extra, {"units": 10, "extraCostCents": 12345,
                                             "contributionMarginCents": baseline["totals"]["contributionMarginCents"] - 12345})
    no_limit = deepcopy(env)
    no_limit["snapshot"]["data"]["inventory"][0].update(sellable_units=100, inventory_cost_cents=500000)
    # 56 * 10000 * (1 - 1/14) = 520000; daily integer-cent rounding <= 14 cents.
    check("refund_money_not_negative_demand", simulate(no_limit), {"units": 56, "netRevenueCents": 520000,
          "variableCostCents": 280000, "spendCents": 56000, "endingUnits": 44}, {"netRevenueCents": 14})
    moved = compare(env, {"transfers": [{"skuId": "sim-sku-1-1", "fromWarehouse": "sim-wh-1",
             "toWarehouse": "sim-wh-2", "date": "2026-09-25", "units": 5, "assumption": ASSUMPTION}]})
    check("internal_transfer_only_reallocates_stock", moved, {"units": 10, "unmetUnits": 46})
    check("repeat_same_input", simulate(env), baseline["totals"])
    if digest(simulate(env)) != digest(baseline):
        cases[-1]["passed"] = False
    return {"passed": all(c["passed"] for c in cases), "cases": cases,
            "decisionMeaning": "保存选择仅表示内部经营决策；本工具不保存决策、不发单、不采购、不执行投放。"}


def make_report(value):
    env = normalize_envelope(value)
    evaluation = evaluate(env)
    checks = verify_scenarios()
    try:
        baseline = {"status": "calculated", "result": simulate(env)}
    except (CalculationError, ValueError, KeyError) as exc:
        baseline = {"status": "unavailable", "reason": str(exc)}
    report = {"marker": MARKER, "dataNature": "demo", "businessId": BUSINESS_ID,
              "evaluationVersion": EVALUATION_VERSION, "calculationVersion": CALCULATION_VERSION,
              "inputHash": digest(env), "engineSourceSha256": hashlib.sha256(Path(__file__).with_name("engine.py").read_bytes()).hexdigest(),
              "evaluationSourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "adapterSourceSha256": hashlib.sha256(Path(__file__).with_name("evaluation_inputs.py").read_bytes()).hexdigest(),
              "adapter": env["evaluationMetadata"], "backtest": evaluation,
              "engineBaseline": baseline, "scenarioVerification": checks,
              "inputScenarioVerification": verify_input_scenarios(env, baseline),
              "decisionSemantics": "内部方案选择 ≠ 实际经营执行；无真实企业预测效果声明",
              "formalIngestionVerification": "not_performed_by_this_offline_tool"}
    report["reportHash"] = digest(report)
    return report


def verify_input_scenarios(env, baseline):
    """Metamorphic controls on whichever isolated input is supplied by the controller."""
    if baseline["status"] != "calculated":
        return {"status": "unavailable", "reason": baseline["reason"], "passed": False}
    base = baseline["result"]
    repeat = simulate(env)
    extra = compare(env, {"extraCostCents": 10000, "extraCostAssumption": ASSUMPTION})
    stock = next(r for r in env["snapshot"]["data"]["inventory"] if r["sku_id"] in {r["skuId"] for r in base["endingInventory"]})
    arrived = compare(env, {"arrivals": [{"skuId": stock["sku_id"], "warehouseId": stock["warehouse_id"],
              "date": (date.fromisoformat(env["snapshot"]["asOf"]) + timedelta(days=1)).isoformat(),
              "units": 10, "assumption": ASSUMPTION}]})
    checks = {
        "identical_input_identical_result": digest(base) == digest(repeat),
        "extra_cost_units_unchanged": extra["totals"]["units"] == base["totals"]["units"],
        "extra_cost_deducted_once": extra["delta"]["contributionMarginCents"] in (None, -10000),
        "replenishment_does_not_create_demand": abs((arrived["totals"]["units"] + arrived["totals"]["unmetUnits"]) -
                                                 (base["totals"]["units"] + base["totals"]["unmetUnits"])) <= 1e-4,
        "replenishment_sales_nondecreasing": arrived["totals"]["units"] + 1e-4 >= base["totals"]["units"],
        "replenishment_extra_sales_no_more_than_extra_stock": arrived["totals"]["units"] - base["totals"]["units"] <= 10.0001,
        "sensitivity_not_probability": arrived["intervalMeaning"] == "assumption_sensitivity_not_confidence_interval",
    }
    return {"status": "verified", "passed": all(checks.values()), "checks": checks,
            "extraCostDelta": extra["delta"], "replenishmentDelta": arrived["delta"],
            "missingMarginMeaning": "毛利缺数据时 extra_cost_deducted_once 仅检查未知值保持未知，非金额核验",
            "actualExecution": False}


def boss_summary(report):
    result = report["backtest"]
    lines = ["# NEO 独立预测与情景核验", "", "**SYNTHETIC_DEMO · NEO 隔离模拟企业 · 非真实经营效果**", "",
             "本工具比较‘沿用最近四周平均’‘沿用最近一周’‘重复上一轮四周经营节奏’。"
             "三种方法在相同日期预测未来四周，计算时不读取未来销量。", "",
             f"回测状态：`{result['status']}`。"]
    if result["status"] == "evaluated":
        lines += [f"覆盖 {result['weeks']} 周、{result['seriesCount']} 个商品/SKU/渠道组合、{len(result['folds'])} 个四周测试窗口。", "",
                  "| 方法 | SKU/渠道 WAPE 误差 | 总体 WAPE 误差 | 平均每组合每周误差（件） |", "|---|---:|---:|---:|"]
        labels = {"fourWeekMean": "最近四周均值", "lastWeek": "最近一周", "seasonalNaive4": "四周周期对照"}
        fmt = lambda x: "无分母" if x is None else f"{x:.2%}"
        for method in METHODS:
            score = result["metrics"][method]
            lines.append(f"| {labels[method]} | {fmt(score['wape'])} | {fmt(result['aggregateMetrics'][method]['wape'])} | {score['maeUnits']:.3f} |")
        lines += ["", "WAPE 是预测与实际的绝对偏差相对于实际总件数的比例，越低越好，不能换成‘准确率’。"
                  "总体误差可能被商品之间的高估与低估抵消，需要同时查看细粒度误差。",
                  f"测试期新品/冷启动销量 {result['coldStartActualUnits']} 件仍计入误差；零销量单元 {result['zeroActualCells']} 个。",
                  f"缺少已知时间 availableAt 的订单记录 {result['availability']['missingAvailableAtRows']} 条；"
                  "这些输入只能证明没有使用未来发生的销量，不能证明已还原当时收到的数据。"]
    coverage = report["engineBaseline"].get("result", {}).get("forecastCoverage", {})
    if coverage.get("status") == "partial":
        lines += ["", "预测范围不完整：" + "、".join(coverage["unestimatedSkuIds"]) + " 的未来需求未估计，不等于零需求。"
                  "其已知库存和到货仍计入期末条件结余，销量/收入仅覆盖有历史依据的 SKU；贡献毛利保持未知，不能用于全范围推荐。",
                  f"未估计需求部分的条件期末库存 {coverage['unestimatedEndingUnits']} 件；成本缺失时库存资金显示未知。"]
    lines += ["", f"季节对照定义：{result.get('seasonMeaning', '不可用')}。",
              "", "情景核验：" + ("通过" if report["scenarioVerification"]["passed"] else "失败") +
              f"，共 {len(report['scenarioVerification']['cases'])} 项独立手算/守恒检查。",
              f"当前输入的重复计算、额外成本与补货守恒检查：{'通过' if report['inputScenarioVerification']['passed'] else '未通过或数据不足'}。",
              "销量预期以支付出库件数计；金额使用分；退款影响净成交额，不作为负需求或自动返库；成本冲回尚未建模。"
              "‘未承接件数’是在指定假设下需求超过可售库存的部分，不是已发生的缺货损失。",
              "到货仅从预计到货日计入供给；增加库存不会凭空增加需求，增加预算也可能只增加成本。",
              "敏感参数上下界是‘假设敏感性范围’，没有概率含义，不称置信区间。",
              "", "工具未选择生产模型、未调参迎合合成数据、未调用外部模型或付费服务。"
              "标准导入/质量/提交/快照路径由总控另行验收，本工具直接读取其导出的封装。",
              "", f"评估版本：`{report['evaluationVersion']}`；引擎版本：`{report['calculationVersion']}`。",
              f"输入指纹：`{report['inputHash']}`。", f"报告指纹：`{report['reportHash']}`。", ""]
    return "\n".join(lines)

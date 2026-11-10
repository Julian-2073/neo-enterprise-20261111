"""Pure point-in-time backtest. No engine, fixture enterprise or provider imports."""
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from statistics import mean
from zoneinfo import ZoneInfo
import hashlib, json
TZ = ZoneInfo("Asia/Shanghai")
METHODS = ("fourWeekMean", "lastWeek", "seasonalNaive4")
METHOD_VERSION = "asof-backtest-v2"

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     allow_nan=False, separators=(",", ":")).encode()).hexdigest()


def instant(value):
    result = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("availableAt/knownAt 必须包含时区")
    return result.astimezone(TZ)


def end_of_day(value):
    return datetime.combine(value, time.max, TZ)


def complete_weeks(snapshot):
    start, end = date.fromisoformat(snapshot["periodStart"]), date.fromisoformat(snapshot["periodEnd"])
    cursor = start + timedelta(days=(7 - start.weekday()) % 7)
    result = []
    while cursor + timedelta(days=6) <= end:
        result.append(cursor)
        cursor += timedelta(days=7)
    return result


def predict(prefix, method):
    if len(prefix) < 4:
        raise ValueError("需要至少四个已观察完整周")
    if method == "fourWeekMean":
        return [mean(prefix[-4:])] * 4
    if method == "lastWeek":
        return [prefix[-1]] * 4
    if method == "seasonalNaive4":
        return list(prefix[-4:])
    raise ValueError("未知对照方法")


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


def safe_instant(value):
    try:
        if not isinstance(value, str) or "T" not in value:
            return None
        return instant(value)
    except (ValueError, TypeError, OverflowError):
        return None


def declared_coverage(snapshot, start, end, cutoff, sources):
    # A published closed-period declaration is an assumption, not an audit proof.
    if not sources or None in sources:
        return False
    for source in sources:
        intervals = []
        for c in snapshot.get("coverage", []):
            if c.get("kind") != "orders" or c.get("sourceId") != source:
                continue
            published = safe_instant(c.get("availableAt"))
            try:
                a, b = date.fromisoformat(c["start"]), date.fromisoformat(c["end"])
            except (ValueError, KeyError, TypeError):
                continue
            if published is not None and published <= cutoff and a <= b and b <= published.date():
                intervals.append((a, b))
        cursor = start
        for a, b in sorted(intervals):
            if a <= cursor <= b:
                cursor = b + timedelta(days=1)
        if cursor <= end:
            return False
    return True


def evaluate_envelope(env, weeks=None):
    s = env["snapshot"]
    weeks = complete_weeks(s) if weeks is None else weeks
    raw_known = env.get("evaluationMetadata", {}).get("knownAt") or env.get("ontologyRef", {}).get("knownAt")
    knowledge = safe_instant(raw_known) if raw_known else end_of_day(date.fromisoformat(s["asOf"]))
    metadata = {"methodVersion": METHOD_VERSION, "timeAware": True,
                "timezone": "Asia/Shanghai", "coverageBasis": "published_source_declaration",
                "labelKnownAt": knowledge.isoformat() if knowledge else None,
                "coverageMeaning": "来源对已结束期间的发布声明，仅为合成/提供方假设，不是独立完整性证明。"}
    if knowledge is None:
        return {"status": "historical_availability_unverified", "reason": "invalid_label_knowledge_time", **metadata}
    if len(weeks) < 16:
        return {"status": "insufficient_history", "minimumWeeks": 16, "weeks": len(weeks), **metadata}
    positions = {w: i for i, w in enumerate(weeks)}
    observations, future_facts = [], 0
    for row in env["facts"]:
        if row.get("kind") != "orders":
            continue
        f = row["fact"]
        d = date.fromisoformat(f["business_date"])
        w = d - timedelta(days=d.weekday())
        if w not in positions:
            future_facts += 1
            continue
        observations.append({"row": row, "day": d, "week": positions[w],
                             "availability": safe_instant(row.get("availableAt")),
                             "key": (f["product_id"], f["sku_id"], f["channel"])})
    observations.sort(key=lambda o: str(o["row"].get("id", "")))
    by_id = {o["row"].get("id"): o for o in observations}
    def root(o):
        seen = set()
        while o["row"].get("revisionOf"):
            parent = o["row"]["revisionOf"]
            if parent in seen or parent not in by_id:
                return None
            seen.add(parent); previous = by_id[parent]
            if previous["day"] != o["day"] or previous["key"] != o["key"] or previous["row"].get("sourceId") != o["row"].get("sourceId") or previous["row"]["fact"]["entry_type"] != o["row"]["fact"]["entry_type"]:
                return None
            o = previous
        return o["row"].get("id")
    for o in observations:
        o["root"] = root(o)
    def select(cutoff, start, end):
        chosen, unresolved, late = {}, [], []
        for o in observations:
            if not start <= o["day"] <= end:
                continue
            if o["availability"] is None or not o["root"]:
                unresolved.append(o); continue
            if o["availability"] > cutoff:
                late.append(o); continue
            current = chosen.get(o["root"])
            if current is None or o["availability"] > current["availability"]:
                chosen[o["root"]] = o
            elif o["availability"] == current["availability"] and o["row"] != current["row"]:
                unresolved.append(o)
        # An available older revision remains valid; late new observations leave a gap.
        gaps = unresolved + [o for o in late if o["root"] not in chosen]
        return list(chosen.values()), gaps, len(late)
    labels, label_gaps, late_labels = select(knowledge, weeks[0], weeks[-1] + timedelta(days=6))
    keys = sorted({o["key"] for o in labels if o["row"]["fact"]["entry_type"] == "paid"})
    if not keys:
        unknown = any(o["availability"] is None or not o["root"] for o in observations if o["row"]["fact"]["entry_type"] == "paid")
        return {"status": "historical_availability_unverified" if unknown else "no_paid_series",
                "weeks": len(weeks), "reason": "unknown_observation_availability" if unknown else "no_paid_labels_known_at_cutoff", **metadata}
    actual = {k: [0] * len(weeks) for k in keys}
    refund_units = refund_cents = paid_cents = 0
    for o in labels:
        f = o["row"]["fact"]
        if f["entry_type"] == "paid":
            actual[o["key"]][o["week"]] += f["quantity"]; paid_cents += f["amount_cents"]
        else:
            refund_units += f["quantity"]; refund_cents += f["amount_cents"]
    sources = {o["row"].get("sourceId") for o in observations}
    sources |= {c.get("sourceId") for c in s.get("coverage", []) if c.get("kind") == "orders"}
    folds, skipped, all_cells = [], [], []
    for cutoff in range(8, len(weeks) - 3, 4):
        train_end = weeks[cutoff] - timedelta(days=1)
        test_end = weeks[cutoff + 3] + timedelta(days=6)
        available = end_of_day(train_end)
        training, training_gaps, late_training = select(available, weeks[0], train_end)
        reason = None; affected = []
        if training_gaps:
            reason = "training_observations_unavailable"; affected = training_gaps
        elif any(weeks[0] <= o["day"] <= test_end for o in label_gaps):
            reason = "label_observations_unavailable"; affected = [o for o in label_gaps if o["day"] <= test_end]
        elif not declared_coverage(s, weeks[0], train_end, available, sources):
            reason = "historical_source_coverage_unverified"
        elif not declared_coverage(s, weeks[cutoff], test_end, knowledge, sources):
            reason = "label_source_coverage_unverified"
        elif not any(o["row"]["fact"]["entry_type"] == "paid" for o in training):
            reason = "no_available_training_series"
        if reason:
            skipped.append({"trainEnd": train_end.isoformat(), "trainingKnownAt": available.isoformat(),
                            "testStart": weeks[cutoff].isoformat(), "testEnd": test_end.isoformat(),
                            "reason": reason, "rowIds": [o["row"].get("id") for o in affected]})
            continue
        prefixes = {}
        for o in training:
            if o["row"]["fact"]["entry_type"] == "paid":
                prefixes.setdefault(o["key"], [0] * cutoff)[o["week"]] += o["row"]["fact"]["quantity"]
        cells = []
        for key in sorted(set(keys) | set(prefixes)):
            prefix = prefixes.get(key)
            predictions = {m: predict(prefix, m) if prefix is not None else [0] * 4 for m in METHODS}
            for h in range(4):
                cells.append({"productId": key[0], "skuId": key[1], "channel": key[2],
                              "weekStart": weeks[cutoff + h].isoformat(), "horizonWeek": h + 1,
                              "actualUnits": actual.get(key, [0] * len(weeks))[cutoff + h],
                              "coldStart": prefix is None,
                              "predictions": {m: predictions[m][h] for m in METHODS}})
        prefix_content = [{"grain": list(k), "units": prefixes[k]} for k in sorted(prefixes)]
        fold = {"trainStart": weeks[0].isoformat(), "trainEnd": train_end.isoformat(),
                "trainingKnownAt": available.isoformat(), "labelKnownAt": knowledge.isoformat(),
                "testStart": weeks[cutoff].isoformat(), "testEnd": test_end.isoformat(),
                "trainingHash": digest(prefix_content), "lateTrainingRowsExcluded": late_training,
                "trainingRows": [{"id": o["row"]["id"], "sourceId": o["row"].get("sourceId"),
                                  "availableAt": o["row"].get("availableAt")} for o in training],
                "metrics": {m: scores([(c["actualUnits"], c["predictions"][m]) for c in cells]) for m in METHODS},
                "cells": cells}
        folds.append(fold); all_cells.extend(cells)
    per_grain = {}
    for name, fields in {"productSkuChannel": ("productId", "skuId", "channel"),
                         "product": ("productId",), "sku": ("skuId",), "channel": ("channel",)}.items():
        rows = []
        identities = sorted({tuple(c[f] for f in fields) for c in all_cells})
        for identity in identities:
            # Aggregate before absolute error only for explicitly coarser grains.
            buckets = defaultdict(lambda: {"actual": 0, "pred": dict.fromkeys(METHODS, 0)})
            for c in all_cells:
                if tuple(c[f] for f in fields) != identity:
                    continue
                b = buckets[c["weekStart"]]
                b["actual"] += c["actualUnits"]
                for m in METHODS:
                    b["pred"][m] += c["predictions"][m]
            rows.append({**dict(zip(fields, identity)), "metrics": {
                m: scores([(b["actual"], b["pred"][m]) for b in buckets.values()]) for m in METHODS}})
        per_grain[name] = rows
    aggregate = defaultdict(lambda: {"actual": 0, "pred": dict.fromkeys(METHODS, 0)})
    for c in all_cells:
        aggregate[c["weekStart"]]["actual"] += c["actualUnits"]
        for m in METHODS:
            aggregate[c["weekStart"]]["pred"][m] += c["predictions"][m]
    return {"status": ("partially_evaluated" if skipped else "evaluated") if folds else "insufficient_coverage",
            **metadata, "weeks": len(weeks), "seriesCount": len(keys), "horizonWeeks": 4,
            "target": "paid_dispatch_units", "unit": "件", "seasonPeriodWeeks": 4,
            "seasonMeaning": env.get("evaluationMetadata", {}).get("seasonMeaning", "四周经营周期假设，须由数据提供方确认；非年度季节性"),
            "folds": folds, "skippedFolds": skipped,
            "metrics": {m: scores([(c["actualUnits"], c["predictions"][m]) for c in all_cells]) for m in METHODS},
            "aggregateMetrics": {m: scores([(b["actual"], b["pred"][m]) for b in aggregate.values()]) for m in METHODS},
            "metricsByGrain": per_grain,
            "coldStartActualUnits": sum(c["actualUnits"] for c in all_cells if c["coldStart"]),
            "zeroActualCells": sum(c["actualUnits"] == 0 for c in all_cells),
            "accountingObserved": {"paidRevenueCents": paid_cents, "refundUnits": refund_units,
                                   "refundCents": refund_cents, "netRevenueCents": paid_cents - refund_cents},
            "availability": {"labelKnownAt": knowledge.isoformat(), "lateLabelRowsExcluded": late_labels,
                             "outOfWindowOrderRowsExcluded": future_facts,
                             "missingAvailableAtRows": sum(r["availability"] is None for r in observations),
                             "meaning": "训练按每个上海预测日截止筛选；标签按单独的 labelKnownAt 截止。未知或晚到的新观测使相应窗口跳过，不以零填补。"},
            "limitations": ["SYNTHETIC_DEMO：只证明工具与切分可运行，不证明真实预测提升。",
                            "WAPE 是误差而非准确率；实际总量为零时返回 null，并保留 MAE 与绝对误差。",
                            "已支付出库件数受历史库存约束，不等于潜在需求；退款不作为负需求。",
                            "声明覆盖不证明商品/渠道采集完整；新品未知销量采用零预测并计入误差。",
                            "不同粒度误差会相互抵消，SKU/渠道误差与总体误差同时展示。",
                            "四周季节对照提前固定，不依据本次误差调参或自动晋升模型。"]}


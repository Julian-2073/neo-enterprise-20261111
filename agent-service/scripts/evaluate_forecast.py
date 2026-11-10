#!/usr/bin/env python3
"""Local-only repeatable evaluation. Uses existing Python, no model/network/DB."""
import argparse
import json
from pathlib import Path
import sys

SERVICE = Path(__file__).resolve().parents[1]
CHECKOUT = SERVICE.parent
sys.path.insert(0, str(SERVICE))

from neo_agent.evaluation import boss_summary, digest, make_report, make_synthetic, normalize_envelope, scenario_fixture
from neo_agent.engine import compare, CalculationError
from neo_agent.evaluation_inputs import load_synthetic_package


def main():
    parser = argparse.ArgumentParser(description="SYNTHETIC_DEMO 24-week offline forecast/scenario evaluation")
    sources = parser.add_mutually_exclusive_group()
    sources.add_argument("--input", type=Path, help="Exported {snapshot,facts,domain} JSON or {envelope:...}")
    sources.add_argument("--synthetic-package", type=Path, help="Read-only sibling synthetic package directory with manifest.json")
    parser.add_argument("--assumptions", type=Path, help="Optional ScenarioAssumptions JSON; no execution")
    parser.add_argument("--seed", type=int, default=20261004)
    parser.add_argument("--output-dir", type=Path, default=CHECKOUT / "outputs/forecast-evaluation")
    args = parser.parse_args()
    output = args.output_dir.resolve()
    if not output.is_relative_to(CHECKOUT.resolve()) or output == CHECKOUT.resolve():
        parser.error("输出必须为当前隔离副本内的子目录；禁止写主仓库或共享环境")
    try:
        raw = load_synthetic_package(args.synthetic_package) if args.synthetic_package else json.loads(args.input.read_text()) if args.input else make_synthetic(args.seed)
        env = normalize_envelope(raw)
        report = make_report(raw)
        if args.assumptions:
            assumptions = json.loads(args.assumptions.read_text())
            scenario = compare(env, assumptions)
            report["requestedScenario"] = {"result": scenario, "resultHash": digest(scenario),
                                          "assumptionsHash": digest(assumptions), "actualExecution": False}
            report.pop("reportHash")
            report["reportHash"] = digest(report)
        output.mkdir(parents=True, exist_ok=True)
        for filename, value in (("engine-envelope.json", env), ("scenario-control-envelope.json", scenario_fixture()),
                                ("report.json", report)):
            (output / filename).write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n")
        (output / "boss-summary.md").write_text(boss_summary(report))
        print(json.dumps({"marker": "SYNTHETIC_DEMO", "output": str(output), "inputHash": report["inputHash"],
                          "reportHash": report["reportHash"], "backtest": report["backtest"]["status"],
                          "scenarioChecksPassed": report["scenarioVerification"]["passed"]}, ensure_ascii=False))
        return 0 if report["scenarioVerification"]["passed"] and report["inputScenarioVerification"]["passed"] and report["backtest"]["status"] == "evaluated" else 1
    except (CalculationError, ValueError, KeyError, OSError) as exc:
        print(json.dumps({"marker": "SYNTHETIC_DEMO", "status": "invalid_input", "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path("cross-results")
OUT = Path("research-cross-matrix-30d-summary.json")


def pf_value(value):
    if value is None:
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


rows = []
for path in sorted(ROOT.glob("cross-*.json")):
    data = json.loads(path.read_text())
    cfg = data["matrixConfig"]
    p = data["portfolio"]
    rows.append({
        "key": cfg["key"],
        "rr": float(cfg["rr"]),
        "stopScale": float(cfg["stopScale"]),
        "zoneScoreDelta": int(cfg["zoneScoreDelta"]),
        "trades": p.get("trades", 0),
        "takeProfit": p.get("takeProfit", 0),
        "stopLoss": p.get("stopLoss", 0),
        "netR": p.get("netR", 0.0),
        "winRate": p.get("winRate", 0.0),
        "profitFactor": p.get("profitFactor"),
        "maxDrawdownR": p.get("maxDrawdownR", 0.0),
    })

if not rows:
    raise SystemExit("no cross matrix results")

baseline = next(
    (r for r in rows if r["rr"] == 1.8 and r["stopScale"] == 1.0 and r["zoneScoreDelta"] == 0),
    None,
)
if baseline is None:
    raise SystemExit("frozen baseline combination missing")

for r in rows:
    r["deltaTrades"] = r["trades"] - baseline["trades"]
    r["deltaNetR"] = r["netR"] - baseline["netR"]
    r["deltaProfitFactor"] = pf_value(r["profitFactor"]) - pf_value(baseline["profitFactor"])
    r["deltaMaxDrawdownR"] = r["maxDrawdownR"] - baseline["maxDrawdownR"]

# Pareto frontier: maximize trades, netR and PF, minimize DD.
def dominates(a, b):
    av = (a["trades"], a["netR"], pf_value(a["profitFactor"]), -a["maxDrawdownR"])
    bv = (b["trades"], b["netR"], pf_value(b["profitFactor"]), -b["maxDrawdownR"])
    return all(x >= y for x, y in zip(av, bv)) and any(x > y for x, y in zip(av, bv))

pareto = [r for r in rows if not any(dominates(o, r) for o in rows if o is not r)]
pareto.sort(key=lambda r: (-r["netR"], -r["trades"], -pf_value(r["profitFactor"]), r["maxDrawdownR"]))
ranked = sorted(rows, key=lambda r: (-r["netR"], -r["trades"], -pf_value(r["profitFactor"]), r["maxDrawdownR"]))
frequency_ranked = sorted(rows, key=lambda r: (-r["trades"], -r["netR"], -pf_value(r["profitFactor"]), r["maxDrawdownR"]))

out = {
    "count": len(rows),
    "baseline": baseline,
    "pareto": pareto,
    "rankedByNetR": ranked,
    "rankedByFrequency": frequency_ranked,
}
OUT.write_text(json.dumps(out, indent=2))
print(json.dumps({"count": len(rows), "baseline": baseline, "paretoTop": pareto[:10]}, indent=2))

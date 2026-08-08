from __future__ import annotations

import json
from pathlib import Path

ROOT = Path("matrix-results")
rows = []
for path in sorted(ROOT.rglob("*.json")):
    data = json.loads(path.read_text())
    if "portfolio" not in data or "matrixConfig" not in data:
        continue
    p = data["portfolio"]
    cfg = data["matrixConfig"]
    rows.append({
        "key": cfg["key"],
        "axis": cfg["axis"],
        "value": cfg["value"],
        "trades": p.get("trades", 0),
        "takeProfit": p.get("takeProfit", 0),
        "stopLoss": p.get("stopLoss", 0),
        "netR": p.get("netR", 0),
        "winRate": p.get("winRate", 0),
        "profitFactor": p.get("profitFactor", 0),
        "maxDrawdownR": p.get("maxDrawdownR", 0),
    })

baseline = next((r for r in rows if r["axis"] == "baseline"), None)
if baseline is None:
    raise SystemExit("baseline result missing")

for row in rows:
    row["deltaTrades"] = row["trades"] - baseline["trades"]
    row["deltaNetR"] = row["netR"] - baseline["netR"]
    row["deltaProfitFactor"] = row["profitFactor"] - baseline["profitFactor"]
    row["deltaMaxDrawdownR"] = row["maxDrawdownR"] - baseline["maxDrawdownR"]

ranked = sorted(
    rows,
    key=lambda r: (
        r["netR"],
        -r["maxDrawdownR"],
        r["profitFactor"],
        r["trades"],
    ),
    reverse=True,
)

by_axis = {}
for row in rows:
    by_axis.setdefault(row["axis"], []).append(row)
for axis in by_axis:
    by_axis[axis] = sorted(by_axis[axis], key=lambda r: str(r["value"]))

out = {
    "baseline": baseline,
    "count": len(rows),
    "ranked": ranked,
    "byAxis": by_axis,
}
Path("research-matrix-30d-summary.json").write_text(json.dumps(out, indent=2))
print("MATRIX_COUNT", len(rows))
print("BASELINE", json.dumps(baseline))
for row in ranked[:15]:
    print("TOP", json.dumps(row))

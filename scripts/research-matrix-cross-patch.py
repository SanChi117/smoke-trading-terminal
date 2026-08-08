from __future__ import annotations

import argparse
import importlib.util
from pathlib import Path


def load_patch_module():
    path = Path(__file__).with_name("research-matrix-patch.py")
    spec = importlib.util.spec_from_file_location("research_matrix_patch", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rr", type=float, required=True)
    parser.add_argument("--stop-scale", type=float, required=True)
    parser.add_argument("--zone-score-delta", type=int, required=True)
    args = parser.parse_args()

    patch = load_patch_module()
    # Apply all three sensitive axes from the same frozen V5 baseline checkout.
    patch.patch_rr(args.rr)
    patch.patch_stop_scale(args.stop_scale)
    patch.patch_zone_score(args.zone_score_delta)


if __name__ == "__main__":
    main()

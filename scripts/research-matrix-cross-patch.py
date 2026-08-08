from __future__ import annotations

import argparse

from research_matrix_patch import patch_rr, patch_stop_scale, patch_zone_score


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rr", type=float, required=True)
    parser.add_argument("--stop-scale", type=float, required=True)
    parser.add_argument("--zone-score-delta", type=int, required=True)
    args = parser.parse_args()

    # Apply all three sensitive axes from the same frozen V5 baseline checkout.
    patch_rr(args.rr)
    patch_stop_scale(args.stop_scale)
    patch_zone_score(args.zone_score_delta)


if __name__ == "__main__":
    main()

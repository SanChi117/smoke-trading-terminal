import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: [
      "app/components/TerminalPro.tsx",
      "app/components/ProChart.tsx",
      "app/audit/page.tsx",
      "app/components/LevelChart.tsx",
      "app/components/ProLevelChart.tsx",
      "app/components/TerminalV6.tsx",
    ],
    rules: {
      // These client components intentionally synchronize React state with
      // Binance streams, localStorage and symbol/timeframe changes.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["app/components/LevelChart.tsx"],
    rules: {
      // The chart's zone-freshness label intentionally falls back to wall-clock
      // time only when no evaluated analysis timestamp is available. This is a
      // display-only annotation and does not feed V5 decisions or paper logic.
      "react-hooks/purity": "off",
    },
  },
  {
    files: ["app/components/ProLevelChart.tsx"],
    rules: {
      // The compact chart calculation mutates only the domain bounds; the
      // intermediate center/half declarations are intentionally grouped.
      "prefer-const": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;

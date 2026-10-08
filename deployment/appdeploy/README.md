# AppDeploy release

This is a hosting adapter for the existing SMOKE terminal, not a separate product.

Run from the repository root:

```sh
npm ci
npm test
node scripts/prepare-appdeploy.mjs
```

The last command resolves the canonical TerminalV6 and audit dependency trees into ignored `.appdeploy-release/`. It replaces only the hosting-specific Next link and public transport bindings. V5/QFVG source is copied unchanged. `template/` contains the AppDeploy React/Vite entrypoint, SDK public-data proxy, CSS declarations and browser acceptance suite.

App id: `smoke-trading-terminal-0kl792`. URL: https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/

Publish changed generated files through AppDeploy; keep polling until ready/failed and inspect runtime errors. Platform ready without e2e results is not a completed e2e suite. Private exchange data, credentials and actual orders are not part of this public release. Current journal storage is browser-local and does not migrate automatically across site domains. The full durable Trading OS runtime is still being integrated.

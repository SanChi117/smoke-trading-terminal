import { existsSync } from 'node:fs';
import { ExecutionStore } from '../core/ledger/execution-store.mjs';
import { BinanceAutoGateway } from '../integrations/binance/auto-gateway.ts';
import { reconcileExecutionIntents } from '../services/execution/reconcile-intents.ts';

const [databasePath, afterId] = process.argv.slice(2);
if (!databasePath || !existsSync(databasePath)) throw new Error('Usage: node --experimental-strip-types scripts/reconcile-execution.mjs EXISTING_LEDGER.sqlite [cursor]');
const store = new ExecutionStore(databasePath);
try {
  const gateway = new BinanceAutoGateway({ apiKey: process.env.BINANCE_AUTO_API_KEY ?? '', secretKey: process.env.BINANCE_AUTO_SECRET_KEY ?? '' });
  const result = await reconcileExecutionIntents(store, gateway, { isolatedAutoAccount: process.env.SMOKE_AUTO_ACCOUNT_ISOLATED === 'true', afterId });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (result.mode === 'SAFE_MODE') process.exitCode = 2;
} finally { store.close(); }

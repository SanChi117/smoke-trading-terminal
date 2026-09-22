import { ObservationStore } from '../core/ledger/observation-store.mjs';
import { binancePublicRead, observationTick, runObservationLoop } from '../services/orchestrator/observation-runner.ts';

const [databasePath, symbolList, mode] = process.argv.slice(2);
if (!databasePath || !symbolList || (mode && mode !== '--once')) throw new Error('Usage: node --experimental-strip-types scripts/run-observation-server.mjs ledger.sqlite BTCUSDT,ETHUSDT [--once]');
const store = new ObservationStore(databasePath);
const controller = new AbortController();
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => controller.abort());
const tick = () => observationTick(store, symbolList.split(','), binancePublicRead(), { notificationChatId: process.env.TELEGRAM_AUTHORIZED_CHAT_ID });
const report = result => process.stdout.write(JSON.stringify(result) + '\n');
try {
  if (mode === '--once') report(await tick());
  else await runObservationLoop(tick, { signal: controller.signal, onResult: report });
} finally { store.close(); }

import { analyzeLevelFlow } from './mtf-level-strategy.ts';
import type { MtfLevelAnalysis, TimeframeBundle } from './mtf-level-strategy.ts';

// A versioned, PAPER-only boundary between the terminal and strategy modules.
// Installing a module never activates it; selecting a new strategy requires a
// separate reviewed change to ACTIVE_PAPER_STRATEGY_ID.
export type PaperStrategyModule = Readonly<{
  id: string;
  version: string;
  executionAuthorized: false;
  requiredTimeframes: readonly ('1w' | '1d' | '4h' | '15m' | '5m')[];
  analyze: (symbol: string, bundle: TimeframeBundle, closeAt: number) => MtfLevelAnalysis;
}>;

export const ACTIVE_PAPER_STRATEGY_ID = 'V5_UNMODIFIED' as const;

const modules = new Map<string, PaperStrategyModule>();
const expectedFrames = ['1w', '1d', '4h', '15m', '5m'] as const;

export function registerPaperStrategyModule(module: PaperStrategyModule): void {
  if (!module || !/^[A-Z][A-Z0-9_]{2,40}$/.test(module.id) ||
      !/^[A-Za-z0-9._-]{1,40}$/.test(module.version) ||
      module.executionAuthorized !== false ||
      typeof module.analyze !== 'function' ||
      !Array.isArray(module.requiredTimeframes) ||
      expectedFrames.some(tf => !module.requiredTimeframes.includes(tf)) ||
      modules.has(module.id)) {
    throw new Error('PAPER_STRATEGY_MODULE_INVALID_OR_DUPLICATED');
  }
  modules.set(module.id, Object.freeze({...module}));
}

registerPaperStrategyModule({
  id: ACTIVE_PAPER_STRATEGY_ID,
  version: 'V5_STABLE',
  executionAuthorized: false,
  requiredTimeframes: expectedFrames,
  analyze: analyzeLevelFlow,
});

export function listPaperStrategyModules(): readonly Readonly<{
  id: string;
  version: string;
  active: boolean;
  executionAuthorized: false;
}>[] {
  return [...modules.values()].map(module => Object.freeze({
    id: module.id,
    version: module.version,
    active: module.id === ACTIVE_PAPER_STRATEGY_ID,
    executionAuthorized: false as const,
  }));
}

export function analyzeActivePaperStrategy(
  symbol: string,
  bundle: TimeframeBundle,
  closeAt: number,
): MtfLevelAnalysis {
  const activeStrategy = modules.get(ACTIVE_PAPER_STRATEGY_ID);
  if (!activeStrategy || activeStrategy.executionAuthorized !== false ||
      !Number.isSafeInteger(closeAt) || closeAt <= 0 ||
      !/^[A-Z0-9]{3,20}USDT$/.test(symbol) ||
      expectedFrames.some(tf => !Array.isArray(bundle[tf]) ||
        bundle[tf].length === 0)) {
    throw new Error('PAPER_ACTIVE_STRATEGY_OR_DATA_UNAVAILABLE');
  }
  const result = activeStrategy.analyze(symbol, bundle, closeAt);
  if (!result || result.symbol !== symbol ||
      !['ready', 'watch', 'blocked'].includes(result.state) ||
      !Number.isFinite(result.confidence) ||
      (result.state === 'ready' &&
        (!['long', 'short'].includes(result.side ?? '') ||
          ![result.entry, result.stop, result.target].every(
            value => typeof value === 'number' && Number.isFinite(value) && value > 0)))) {
    throw new Error('PAPER_STRATEGY_INVALID_RESULT');
  }
  return result;
}

export type TerminalView = { selected: string; timeframes: Record<string, string> };
const fallback = new Map<string, string>();
const storageKey = (workspace: string) => `smoke-terminal-view:${encodeURIComponent(workspace)}`;
const eventName = 'smoke-terminal-view';

export function parseTerminalView(raw: string | null, symbols: readonly string[], intervals: readonly string[]): TerminalView {
  const result: TerminalView = { selected: symbols[0] ?? 'BTCUSDT', timeframes: {} };
  if (!raw || raw.length > 10_000) return result;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
    if (symbols.includes(value.selected)) result.selected = value.selected;
    if (value.timeframes && typeof value.timeframes === 'object' && !Array.isArray(value.timeframes)) {
      for (const symbol of symbols) if (intervals.includes(value.timeframes[symbol])) result.timeframes[symbol] = value.timeframes[symbol];
    }
  } catch { /* Restore usable defaults when browser preferences are corrupt. */ }
  return result;
}

export function readTerminalView(workspace: string): string | null {
  if (typeof window === 'undefined') return null;
  if (fallback.has(workspace)) return fallback.get(workspace)!;
  try { return window.localStorage.getItem(storageKey(workspace)); } catch { return null; }
}
export function writeTerminalView(workspace: string, value: TerminalView): void {
  const raw = JSON.stringify(value);
  try { window.localStorage.setItem(storageKey(workspace), raw); fallback.delete(workspace); }
  catch { fallback.set(workspace, raw); }
  window.dispatchEvent(new Event(eventName));
}
export function subscribeTerminalView(changed: () => void): () => void {
  window.addEventListener('storage', changed);
  window.addEventListener(eventName, changed);
  return () => { window.removeEventListener('storage', changed); window.removeEventListener(eventName, changed); };
}

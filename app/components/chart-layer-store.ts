const fallback = new Map<string, string>();
const eventName = 'smoke-chart-layers';
const storageKey = (key: string) => `${key}:layers`;

export function readChartLayers(key: string): string | null {
  if (typeof window === 'undefined') return null;
  // Retain this session's choice even when storage writes are denied.
  if (fallback.has(key)) return fallback.get(key)!;
  try { return window.localStorage.getItem(storageKey(key)); } catch { return null; }
}

export function writeChartLayers(key: string, layers: Record<string, boolean>): void {
  const raw = JSON.stringify(layers);
  try { window.localStorage.setItem(storageKey(key), raw); fallback.delete(key); }
  catch { fallback.set(key, raw); }
  window.dispatchEvent(new Event(eventName));
}

export function subscribeChartLayers(changed: () => void): () => void {
  window.addEventListener('storage', changed);
  window.addEventListener(eventName, changed);
  return () => { window.removeEventListener('storage', changed); window.removeEventListener(eventName, changed); };
}

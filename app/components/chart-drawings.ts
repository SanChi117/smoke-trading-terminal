export type DrawingPoint = { time: number; price: number };
type DrawingIdentity = { id: string; locked?: boolean };
export type Drawing = DrawingIdentity & (
  | { type: 'hline'; price: number }
  | { type: 'trend' | 'rect' | 'fib'; a: DrawingPoint; b: DrawingPoint }
  | { type: 'note'; time: number; price: number; text: string }
);
export type DrawingHistory = { key: string; past: Drawing[][]; present: Drawing[]; future: Drawing[][] };
const MAX_DRAWINGS = 500;
const MAX_HISTORY = 50;
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const point = (value: unknown): value is DrawingPoint => {
  if (!value || typeof value !== 'object') return false;
  const p = value as DrawingPoint;
  return Number.isSafeInteger(p.time) && p.time >= 0 && positive(p.price);
};

export function parseDrawings(raw: string | null): Drawing[] {
  if (!raw || raw.length > 1_000_000) return [];
  try {
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values) || values.length > MAX_DRAWINGS) return [];
    const ids = new Set<string>();
    const result: Drawing[] = [];
    for (const value of values) {
      if (!value || typeof value !== 'object') continue;
      const d = value as Drawing;
      if (typeof d.id !== 'string' || !d.id || d.id.length > 128 || ids.has(d.id)) continue;
      const identity = { id: d.id, locked: d.locked === true };
      if (d.type === 'hline' && positive(d.price)) result.push({ ...identity, type: d.type, price: d.price });
      else if (d.type === 'note' && point(d) && typeof d.text === 'string' && d.text.trim() && d.text.length <= 1000)
        result.push({ ...identity, type: d.type, time: d.time, price: d.price, text: d.text });
      else if ((d.type === 'trend' || d.type === 'rect' || d.type === 'fib') && point(d.a) && point(d.b))
        result.push({ ...identity, type: d.type, a: { time: d.a.time, price: d.a.price }, b: { time: d.b.time, price: d.b.price } });
      else continue;
      ids.add(d.id);
    }
    return result;
  } catch { return []; }
}

export function drawingPrices(drawing: Drawing): number[] {
  return drawing.type === 'hline' || drawing.type === 'note' ? [drawing.price] : [drawing.a.price, drawing.b.price];
}

export function restoreDrawingHistory(key: string, raw: string | null): DrawingHistory {
  return { key, past: [], present: parseDrawings(raw), future: [] };
}
export function changeDrawings(history: DrawingHistory, key: string, next: Drawing[]): DrawingHistory {
  if (history.key !== key || next.length > MAX_DRAWINGS) return history;
  const validated = parseDrawings(JSON.stringify(next));
  if (validated.length !== next.length || JSON.stringify(validated) === JSON.stringify(history.present)) return history;
  return { key, past: [...history.past, history.present].slice(-MAX_HISTORY), present: validated, future: [] };
}
export function stepDrawingHistory(history: DrawingHistory, key: string, direction: 'undo' | 'redo'): DrawingHistory {
  if (history.key !== key) return history;
  if (direction === 'undo') {
    const previous = history.past.at(-1);
    return previous ? { key, past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future].slice(0, MAX_HISTORY) } : history;
  }
  const next = history.future[0];
  return next ? { key, past: [...history.past, history.present].slice(-MAX_HISTORY), present: next, future: history.future.slice(1) } : history;
}

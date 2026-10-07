import test from 'node:test';
import assert from 'node:assert/strict';
import { changeDrawings, drawingPrices, parseDrawings, restoreDrawingHistory, stepDrawingHistory } from '../app/components/chart-drawings.ts';

const note = { id: 'note1', type: 'note', time: 1000, price: 100, text: 'Уровень' };
const line = { id: 'line1', type: 'trend', a: { time: 1000, price: 90 }, b: { time: 2000, price: 110 } };

test('persisted notes and all supported drawing shapes restore without assuming two anchors', () => {
  const records = [note, line, { ...line, id: 'rect1', type: 'rect' }, { ...line, id: 'fib1', type: 'fib' }, { id: 'h1', type: 'hline', price: 95, locked: true }];
  const restored = parseDrawings(JSON.stringify(records));
  assert.equal(restored.length, 5);
  assert.deepEqual(restored.flatMap(drawingPrices), [100, 90, 110, 90, 110, 90, 110, 95]);
  assert.equal(restored.at(-1).locked, true);
  assert.deepEqual(parseDrawings(JSON.stringify(restored)), restored);
});

test('corrupt storage cannot inject malformed shapes, duplicate IDs or unbounded history', () => {
  for (const raw of ['null', '{}', 'broken', ' '.repeat(1_000_001)]) assert.deepEqual(parseDrawings(raw), []);
  const values = [note, note, { ...line, a: null }, { ...line, b: { time: 1, price: -1 } }, { ...note, id: 'bad', text: 'x'.repeat(1001) }, { id: 'x', type: 'script' }];
  assert.deepEqual(parseDrawings(JSON.stringify(values)), [{ ...note, locked: false }]);
  assert.deepEqual(parseDrawings(JSON.stringify(Array.from({ length: 501 }, (_, i) => ({ ...note, id: String(i) })))), []);
});

test('edit, clear, undo and redo are reversible and scoped to the restored workspace', () => {
  let history = restoreDrawingHistory('BTC', JSON.stringify([note]));
  assert.equal(changeDrawings(history, 'ETH', [line]), history);
  history = changeDrawings(history, 'BTC', [...history.present, line]);
  history = changeDrawings(history, 'BTC', []);
  history = stepDrawingHistory(history, 'BTC', 'undo');
  assert.equal(history.present.length, 2);
  history = stepDrawingHistory(history, 'BTC', 'undo');
  assert.equal(history.present.length, 1);
  history = stepDrawingHistory(history, 'BTC', 'redo');
  assert.equal(history.present.length, 2);
  history = changeDrawings(history, 'BTC', [{ ...note, text: 'Новая заметка' }]);
  assert.equal(history.future.length, 0);
  assert.equal(stepDrawingHistory(history, 'ETH', 'undo'), history);
  const other = restoreDrawingHistory('ETH', JSON.stringify([line]));
  assert.equal(other.past.length, 0);
  assert.equal(other.present[0].id, 'line1');
  for (let i = 0; i < 60; i++) history = changeDrawings(history, 'BTC', [{ ...note, text: `Edit ${i}` }]);
  assert.equal(history.past.length, 50);
});

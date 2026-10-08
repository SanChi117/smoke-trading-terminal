import { db, json, error, requireAuth, type RouterRoutes } from '@appdeploy/sdk';
import { validateBrowserCapture, type MarketObservation } from '../services/market-data/observation-features';

function failure(caught: unknown) {
  const message = caught instanceof Error ? caught.message : 'OBSERVATION_FAILED';
  return error(message, message.startsWith('INVALID_') ? 400 : message.includes('429') ? 429 : 503);
}

export const observationRoutes: RouterRoutes = {
  'POST /api/observations': [requireAuth(), async ({ body, user }) => {
    let result: MarketObservation;
    try { result = await validateBrowserCapture(body); } catch (caught) { return failure(caught); }
    const record = { result };
    if (new TextEncoder().encode(JSON.stringify(record)).length > 240_000) return error('OBSERVATION_TOO_LARGE', 413);
    // SDK errors (including quota exhaustion) propagate; no automatic write retries.
    const [id] = await db.add(`observations:${user!.userId}`, [record]);
    if (!id) return error('JOURNAL_WRITE_FAILED', 503);
    return json({ result, id }, 201);
  }],
  'GET /api/observations': [requireAuth(), async ({ user, query }) => {
    if (query.nextToken && query.nextToken.length > 4096) return error('INVALID_CURSOR', 400);
    const page = await db.list<{ result: MarketObservation }>(`observations:${user!.userId}`, { limit: 10, nextToken: query.nextToken });
    return json(page);
  }],
};

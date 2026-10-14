import type {PilotPaperState} from './paper-pilot-state.ts';
import type {PortablePaperStore} from './portable-paper-runtime.ts';

// The application injects a PostgreSQL driver's query method.
// No database credentials, pool, AppDeploy SDK, or browser dependency here.
export type PaperPgQuery = (
  sql: string, values: readonly unknown[],
) => Promise<{rows: readonly Record<string, unknown>[]}>;

const LEDGER_KEY=/^[a-z][a-z0-9_-]{1,48}$/;
const SYMBOL=/^[A-Z0-9]{3,20}USDT$/;

// Atomic optimistic concurrency, including first-insert races.
// A missing row is inserted ONLY for expected revision 0.
// The SELECT returns 1 for an actual stored write, 0 for a lost CAS race.
const CAS_SQL=`
WITH updated AS (
  UPDATE smoke_paper_state_v1
  SET revision = $4, document = $5::jsonb, updated_at = CURRENT_TIMESTAMP
  WHERE ledger_key = $1 AND symbol = $2 AND revision = $3
  RETURNING 1
), inserted AS (
  INSERT INTO smoke_paper_state_v1 (ledger_key, symbol, revision, document)
  SELECT $1, $2, $4, $5::jsonb WHERE $3 = 0
  ON CONFLICT (ledger_key, symbol) DO NOTHING
  RETURNING 1
)
SELECT (SELECT COUNT(*) FROM updated) +
       (SELECT COUNT(*) FROM inserted) AS applied
`;

export function createPostgresPaperStore(
  query: PaperPgQuery,
  ledgerKey: string,
): PortablePaperStore {
  if (typeof query !== 'function' || !LEDGER_KEY.test(ledgerKey)) {
    throw Error('PAPER_PG_INVALID_CONFIG');
  }

  return Object.freeze({
    async read(symbol: string): Promise<PilotPaperState | null> {
      if (!SYMBOL.test(symbol))throw Error('PAPER_PG_INVALID_SYMBOL');
      const result = await query(
        'SELECT revision, document FROM smoke_paper_state_v1 ' +
        'WHERE ledger_key = $1 AND symbol = $2',
        [ledgerKey,symbol],
      );
      if (!result || !Array.isArray(result.rows) || result.rows.length > 1)
        throw Error('PAPER_PG_CORRUPT_READ_RESULT');
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      const payload: unknown = typeof row.document === 'string'
        ? JSON.parse(row.document) : row.document;
      if (!payload || typeof payload !== 'object' ||
          Array.isArray(payload) ||
          (payload as PilotPaperState).revision !== Number(row.revision)) {
        throw Error('PAPER_PG_REVISION_MISMATCH');
      }
      return payload as PilotPaperState;
    },

    async compareAndSwap(
      symbol: string,
      previousRevision: number,
      next: PilotPaperState,
    ): Promise<boolean> {
      if (!SYMBOL.test(symbol) ||
          !Number.isSafeInteger(previousRevision) || previousRevision < 0 ||
          !next || next.id !== symbol || next.symbol !== symbol ||
          next.schema !== 'PAPER_V1' || next.executionAuthorized !== false ||
          !Number.isSafeInteger(next.revision) ||
          next.revision !== previousRevision + 1) {
        throw Error('PAPER_PG_INVALID_WRITE');
      }
      const json = JSON.stringify(next);
      if (typeof json !== 'string' || json.length > 500_000)
        throw Error('PAPER_PG_INVALID_WRITE_SIZE');
      const result = await query(CAS_SQL, [
        ledgerKey,symbol,previousRevision,next.revision,json,
      ]);
      if (!result || !Array.isArray(result.rows) ||
          result.rows.length !== 1 ||
          !['0','1',0,1].includes(result.rows[0].applied as string|number)) {
        throw Error('PAPER_PG_INVALID_CAS_RESULT');
      }
      return Number(result.rows[0].applied) === 1;
    },
  });
}

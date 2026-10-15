// Fail closed if a second browser tab changed the durable PAPER snapshot.
// This is optimistic detection, NOT a cross-tab atomic CAS or a database.
export function assertPaperSnapshotUnchanged<T>(
  memory: T,
  disk: T,
): void {
  if (memory === null || memory === undefined ||
      disk === null || disk === undefined ||
      JSON.stringify(memory) !== JSON.stringify(disk)) {
    throw Error('PAPER_EXTERNAL_STORAGE_CHANGE_RELOAD_REQUIRED');
  }
}

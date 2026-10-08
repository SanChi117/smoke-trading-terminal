export type RequestState<T> = { key: string } & (
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'error'; error: string }
);

/** Abort is advisory: the generation check also rejects late uncooperative responses. */
export class LatestRequest<T> {
  private generation = 0;
  private controller: AbortController | null = null;
  private readonly publish: (state: RequestState<T>) => void;
  constructor(publish: (state: RequestState<T>) => void) { this.publish = publish; }

  cancel(): void {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
  }

  async run(key: string, fetchValue: (signal: AbortSignal) => Promise<T>): Promise<void> {
    this.cancel();
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.publish({ key, status: 'loading' });
    try {
      const value = await fetchValue(controller.signal);
      if (generation === this.generation && !controller.signal.aborted) this.publish({ key, status: 'ready', value });
    } catch (error) {
      if (generation === this.generation && !controller.signal.aborted)
        this.publish({ key, status: 'error', error: error instanceof Error ? error.message : 'Не удалось получить данные' });
    } finally {
      if (generation === this.generation) this.controller = null;
    }
  }
}

/**
 * Serializes async work so callers never overlap (used for AI tool side effects).
 */
export class AsyncSerialQueue {
  private tail: Promise<void> = Promise.resolve();

  runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(() => fn());
    this.tail = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}

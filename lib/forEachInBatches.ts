// Bound database pressure and settle every started operation before propagating
// an error, so callers may safely disconnect without leaving writes in flight.
export async function forEachInBatches<T>(
  items: readonly T[], concurrency: number, processItem: (item: T) => Promise<void>,
) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('Concurrency must be a positive integer.');
  for (let offset = 0; offset < items.length; offset += concurrency) {
    const results = await Promise.allSettled(items.slice(offset, offset + concurrency).map(async (item) => processItem(item)));
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) throw failure.reason;
  }
}

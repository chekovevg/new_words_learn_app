export async function fetchAllSupabaseRows(queryFactory, { batchSize = 1000 } = {}) {
  const firstResult = await queryFactory({ count: 'exact' }).range(0, batchSize - 1);
  throwIfQueryFailed(firstResult);

  const firstBatch = firstResult.data || [];
  const totalCount = Number.isFinite(firstResult.count) ? firstResult.count : null;
  if (firstBatch.length < batchSize || totalCount === firstBatch.length) {
    return firstBatch;
  }

  if (totalCount === null) {
    return fetchRemainingSequentially(queryFactory, firstBatch, batchSize);
  }

  const requests = [];
  for (let from = batchSize; from < totalCount; from += batchSize) {
    const to = Math.min(from + batchSize - 1, totalCount - 1);
    requests.push(queryFactory().range(from, to));
  }

  const results = await Promise.all(requests);
  results.forEach(throwIfQueryFailed);
  return [firstBatch, ...results.map((result) => result.data || [])].flat();
}

async function fetchRemainingSequentially(queryFactory, rows, batchSize) {
  for (let from = batchSize; ; from += batchSize) {
    const result = await queryFactory().range(from, from + batchSize - 1);
    throwIfQueryFailed(result);

    const batch = result.data || [];
    rows.push(...batch);
    if (batch.length < batchSize) return rows;
  }
}

function throwIfQueryFailed({ error }) {
  if (error) throw new Error(error.message);
}

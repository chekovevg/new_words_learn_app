import assert from 'node:assert/strict';
import test from 'node:test';

let fetchAllSupabaseRows;
try {
  ({ fetchAllSupabaseRows } = await import('../src/lib/fetch-all-supabase-rows.js'));
} catch {
  // The first TDD run intentionally exercises the missing implementation.
}

test('fetches remaining Supabase pages in parallel after the counted first page', async () => {
  assert.equal(typeof fetchAllSupabaseRows, 'function');

  const rows = Array.from({ length: 2500 }, (_, id) => ({ id }));
  const requestedRanges = [];
  const pendingPages = new Map();

  const queryFactory = (selectOptions) => ({
    range(from, to) {
      requestedRanges.push([from, to, selectOptions]);
      if (from === 0) {
        return Promise.resolve({
          data: rows.slice(from, to + 1),
          error: null,
          count: rows.length,
          status: 206,
          statusText: 'Partial Content'
        });
      }

      return new Promise((resolve) => pendingPages.set(from, () => resolve({
        data: rows.slice(from, to + 1),
        error: null,
        count: null,
        status: 206,
        statusText: 'Partial Content'
      })));
    }
  });

  const resultPromise = fetchAllSupabaseRows(queryFactory, { batchSize: 1000 });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(
    requestedRanges,
    [
      [0, 999, { count: 'exact' }],
      [1000, 1999, undefined],
      [2000, 2499, undefined]
    ]
  );

  pendingPages.get(1000)();
  pendingPages.get(2000)();
  assert.deepEqual(await resultPromise, rows);
});

test('does not request more pages when the first page contains every row', async () => {
  assert.equal(typeof fetchAllSupabaseRows, 'function');

  let calls = 0;
  const rows = [{ id: 1 }];
  const result = await fetchAllSupabaseRows(
    (selectOptions) => ({
      async range(from, to) {
        calls += 1;
        assert.deepEqual([from, to, selectOptions], [0, 999, { count: 'exact' }]);
        return {
          data: rows,
          error: null,
          count: 1,
          status: 200,
          statusText: 'OK'
        };
      }
    }),
    { batchSize: 1000 }
  );

  assert.equal(calls, 1);
  assert.deepEqual(result, rows);
});

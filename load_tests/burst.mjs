// Dependency-free concurrency check: fires N simultaneous purchases from N distinct users
// and tallies the outcomes, so you can see overselling (naive) vs. correctness (the others).
//
//   node load_tests/burst.mjs [high_speed|transactional|naive_wrong] [N=500] [BASE=http://localhost:8000]
const [mode = 'high_speed', n = '500', base = 'http://localhost:8000'] = process.argv.slice(2);
const path = { high_speed: 'purchase_high_speed', transactional: 'purchase_transactional', naive_wrong: 'purchase_naive_wrong' }[mode];
if (!path) throw new Error('mode must be high_speed | transactional | naive_wrong');

const total = Number(n);
const t0 = performance.now();
const results = await Promise.all(
  Array.from({ length: total }, async (_, i) => {
    const res = await fetch(`${base}/api/${path}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: 1, user_id: 1_000_000 + i + Math.floor(Math.random() * 1e6) * 1000 }),
    }).catch(() => null);
    return res ? res.status : 'network-error';
  }),
);
const secs = (performance.now() - t0) / 1000;

const tally = {};
for (const s of results) tally[s] = (tally[s] ?? 0) + 1;
console.log(`${mode}: ${total} requests in ${secs.toFixed(2)}s (${(total / secs).toFixed(0)} req/s)`);
console.log('status counts:', tally);

const item = await (await fetch(`${base}/api/items/1`)).json();
console.log('item state  :', item);

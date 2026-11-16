import { useState } from 'react';
import { MODES, purchase, randomUserId } from './api.js';

// Fires N concurrent purchases from N distinct random users and tallies HTTP statuses.
// (Browsers cap parallel connections per host, so this is a demo, not a benchmark;
//  use load_tests/ for real throughput numbers.)
export default function BurstTest({ mode, itemId, onDone }) {
  const [count, setCount] = useState(200);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState(null);

  async function run() {
    setRunning(true);
    setSummary(null);
    const t0 = performance.now();
    const results = await Promise.all(Array.from({ length: count }, () => purchase(mode, randomUserId(), itemId)));
    const secs = (performance.now() - t0) / 1000;
    const tally = {};
    for (const r of results) tally[r.status] = (tally[r.status] ?? 0) + 1;
    setSummary({ tally, secs, mode });
    setRunning(false);
    onDone();
  }

  return (
    <section className="card">
      <h2>Burst test</h2>
      <p className="sub">
        Strategy: <b>{MODES[mode].label}</b>. Compare successes (200) against starting stock, so the naive mode
        oversells and the others don't. The transactional mode is slow by design.
      </p>
      <span className="row">
        <input type="number" min="1" max="1000" value={count} onChange={(e) => setCount(Math.min(1000, Number(e.target.value) || 1))} />
        <button type="button" onClick={run} disabled={running}>{running ? 'Running…' : `Fire ${count} requests`}</button>
      </span>
      {summary && (
        <p className="summary">
          {Object.entries(summary.tally).map(([s, n]) => `${s}: ${n}`).join('   ')} — {summary.secs.toFixed(2)}s
        </p>
      )}
    </section>
  );
}

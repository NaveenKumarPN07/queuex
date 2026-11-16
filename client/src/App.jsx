import { useCallback, useEffect, useState } from 'react';
import { MODES, getItem, purchase, randomUserId } from './api.js';
import BurstTest from './BurstTest.jsx';

const ITEM_ID = 1;

export default function App() {
  const [item, setItem] = useState(null);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('high_speed');
  const [userId, setUserId] = useState(randomUserId);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);

  const refresh = useCallback(async () => {
    try {
      setItem(await getItem(ITEM_ID));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  // Poll so the Redis-vs-Postgres gap (outbox lag) is visible.
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, [refresh]);

  async function buy() {
    setBusy(true);
    const r = await purchase(mode, Number(userId), ITEM_ID);
    setLog((l) => [{ ...r, userId, mode, at: new Date().toLocaleTimeString() }, ...l].slice(0, 8));
    setBusy(false);
    refresh();
  }

  return (
    <main>
      <h1>⚡ FlashLock</h1>
      <p className="sub">High-frequency atomic inventory engine: Redis decides, Postgres remembers.</p>

      <section className="card">
        <h2>{item?.name ?? 'Loading…'}</h2>
        {error && <p className="err">API unreachable: {error}. Is the server running and seeded?</p>}
        {item && (
          <dl className="stats">
            <div><dt>Redis stock (live)</dt><dd>{item.redis_stock ?? '—'}</dd></div>
            <div><dt>Postgres stock</dt><dd>{item.db_stock}</dd></div>
            <div><dt>Outbox pending</dt><dd>{item.outbox_pending}</dd></div>
          </dl>
        )}

        <label>
          Strategy
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            {Object.entries(MODES).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
        </label>
        <label>
          User ID
          <span className="row">
            <input type="number" min="1" value={userId} onChange={(e) => setUserId(e.target.value)} />
            <button type="button" className="ghost" onClick={() => setUserId(randomUserId())}>New</button>
          </span>
        </label>
        <button type="button" onClick={buy} disabled={busy || !item}>{busy ? 'Buying…' : 'Buy now'}</button>

        {log.length > 0 && (
          <ul className="log">
            {log.map((e, i) => (
              <li key={i} className={e.status === 200 ? 'ok' : 'bad'}>
                <b>{e.status}</b> {e.message} <small>user {e.userId} · {MODES[e.mode].path} · {e.ms.toFixed(0)} ms · {e.at}</small>
              </li>
            ))}
          </ul>
        )}
      </section>

      <BurstTest mode={mode} itemId={ITEM_ID} onDone={refresh} />
    </main>
  );
}

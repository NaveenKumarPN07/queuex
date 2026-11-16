// The three purchase strategies exposed by the server.
export const MODES = {
  high_speed: { label: 'Redis + Lua (high speed)', path: 'purchase_high_speed' },
  transactional: { label: 'Postgres row lock (transactional)', path: 'purchase_transactional' },
  naive_wrong: { label: 'Naive (race condition)', path: 'purchase_naive_wrong' },
};

export async function purchase(mode, userId, itemId) {
  const started = performance.now();
  try {
    const res = await fetch(`/api/${MODES[mode].path}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, item_id: itemId }),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, message: body.message ?? res.statusText, ms: performance.now() - started };
  } catch {
    return { status: 0, message: 'Network error', ms: performance.now() - started };
  }
}

export async function getItem(itemId) {
  const res = await fetch(`/api/items/${itemId}`);
  if (!res.ok) throw new Error(`Item ${itemId}: HTTP ${res.status}`);
  return res.json();
}

export const randomUserId = () => Math.floor(Math.random() * 2_000_000_000) + 1;

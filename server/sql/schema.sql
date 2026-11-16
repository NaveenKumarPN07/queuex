-- Replaces Django's api/migrations/0001 + 0002.
CREATE TABLE IF NOT EXISTS inventory_items (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    stock_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
    id         BIGSERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    item_id    BIGINT  NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    -- One purchase per user per item. Makes the outbox worker idempotent
    -- (a replayed message can't create a duplicate order).
    CONSTRAINT orders_user_item_unique UNIQUE (user_id, item_id)
);

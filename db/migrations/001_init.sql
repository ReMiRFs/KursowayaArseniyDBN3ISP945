CREATE TABLE users (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email varchar(254) COLLATE pg_catalog.pg_unicode_fast NOT NULL UNIQUE,
    password_hash varchar(60) COLLATE "C" NOT NULL,
    role text NOT NULL,
    CONSTRAINT users_email_normalized CHECK (email <> '' AND email = lower(btrim(email))),
    CONSTRAINT users_password_bcrypt CHECK (password_hash ~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$'),
    CONSTRAINT users_role_valid CHECK (role IN ('admin', 'analyst'))
);

CREATE TABLE sessions (
    token_hash text COLLATE "C" PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    CONSTRAINT sessions_hash_hex CHECK (token_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT sessions_expiration_valid CHECK (expires_at > created_at)
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE sales_channels (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name varchar(50) COLLATE pg_catalog.pg_unicode_fast NOT NULL,
    CONSTRAINT sales_channels_name_trimmed CHECK (char_length(name) > 0 AND name = btrim(name))
);

CREATE UNIQUE INDEX sales_channels_name_lower_uidx ON sales_channels (lower(name));

CREATE TABLE orders (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    number varchar(32) COLLATE "C" NOT NULL UNIQUE,
    sales_channel_id bigint NOT NULL REFERENCES sales_channels (id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'new',
    total_kopecks bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT orders_number_valid CHECK (number ~ '^[A-Z0-9-]{1,32}$'),
    CONSTRAINT orders_status_valid CHECK (status IN ('new', 'processing', 'completed', 'cancelled')),
    CONSTRAINT orders_amount_valid CHECK (total_kopecks BETWEEN 0 AND 999999999)
);

CREATE INDEX orders_created_at_id_idx ON orders (created_at DESC, id DESC);
CREATE INDEX orders_channel_created_at_id_idx ON orders (sales_channel_id, created_at DESC, id DESC);

import { neon } from '@neondatabase/serverless';

let sql = null;
let isInitialized = false;

export function getDb() {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL;
  if (!dbUrl) {
    return null;
  }
  if (!sql) {
    sql = neon(dbUrl);
  }
  return sql;
}

export async function initDb() {
  const db = getDb();
  if (!db || isInitialized) return;

  try {
    await db`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) NOT NULL UNIQUE,
        email VARCHAR(100) NOT NULL UNIQUE,
        phone VARCHAR(20) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        balance NUMERIC(12,2) NOT NULL DEFAULT 0.00,
        demo_balance NUMERIC(12,2) NOT NULL DEFAULT 10000.00,
        role VARCHAR(20) NOT NULL DEFAULT 'user',
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Ensure ALL columns exist and legacy constraints do not block inserts
    await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(100)`;
    await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(100)`;
    await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(100)`;
    await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50) DEFAULT ''`;
    await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS password VARCHAR(255) DEFAULT ''`;
    await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255) DEFAULT ''`;
    await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS balance NUMERIC(12,2) DEFAULT 0.00`;
    await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS demo_balance NUMERIC(12,2) DEFAULT 10000.00`;
    await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user'`;
    await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'`;
    await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`;
    await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`;

    try { await db`ALTER TABLE users ALTER COLUMN name DROP NOT NULL`; } catch (e) {}
    try { await db`ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`; } catch (e) {}
    try { await db`ALTER TABLE users ALTER COLUMN password DROP NOT NULL`; } catch (e) {}
    try { await db`ALTER TABLE users ALTER COLUMN phone DROP NOT NULL`; } catch (e) {}

    // Ensure ID column has an auto-increment sequence
    try {
      await db`CREATE SEQUENCE IF NOT EXISTS users_id_seq`;
      await db`ALTER TABLE users ALTER COLUMN id SET DEFAULT nextval('users_id_seq')`;
      await db`ALTER SEQUENCE users_id_seq OWNED BY users.id`;
    } catch (seqErr) {}
  } catch (e) { console.error('Error creating/migrating users table:', e); }

  try {
    await db`
      CREATE TABLE IF NOT EXISTS trades (
        id SERIAL PRIMARY KEY,
        trade_ref VARCHAR(50) NOT NULL UNIQUE,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        trade_type VARCHAR(10) NOT NULL,
        stake NUMERIC(10,2) NOT NULL,
        entry_rate NUMERIC(10,4) NOT NULL,
        exit_rate NUMERIC(10,4),
        multiplier NUMERIC(6,2),
        payout NUMERIC(10,2) NOT NULL DEFAULT 0.00,
        result VARCHAR(20) NOT NULL DEFAULT 'pending',
        is_demo BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP WITH TIME ZONE
      )
    `;
  } catch (e) { console.error('Error creating trades table:', e); }

  try {
    await db`
      CREATE TABLE IF NOT EXISTS deposits (
        id SERIAL PRIMARY KEY,
        deposit_ref VARCHAR(50) NOT NULL UNIQUE,
        username VARCHAR(50),
        amount_kes NUMERIC(10,2) NOT NULL,
        amount_usd NUMERIC(10,2),
        currency VARCHAR(10) NOT NULL DEFAULT 'kes',
        method VARCHAR(30) NOT NULL DEFAULT 'mpesa',
        phone VARCHAR(20) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;
  } catch (e) { console.error('Error creating deposits table:', e); }

  try {
    await db`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        withdraw_ref VARCHAR(50) NOT NULL UNIQUE,
        username VARCHAR(50),
        amount_kes NUMERIC(10,2) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;
  } catch (e) { console.error('Error creating withdrawals table:', e); }

  try {
    await db`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(50) PRIMARY KEY,
        value TEXT NOT NULL
      )
    `;
  } catch (e) { console.error('Error creating settings table:', e); }

  try {
    await db`
      INSERT INTO users (username, email, phone, password_hash, balance, demo_balance, role)
      VALUES ('admin', 'admin@malicrush.com', '254712345678', 'Aa@123', 100000.00, 100000.00, 'admin')
      ON CONFLICT (username) DO NOTHING
    `;
  } catch (e) {}

  isInitialized = true;
}

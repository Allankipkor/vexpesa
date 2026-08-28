import { neon } from '@neondatabase/serverless';

let sql = null;
let isInitialized = false;

export function getDb() {
  const dbUrl = process.env.DATABASE_URL || 
                process.env.POSTGRES_URL || 
                process.env.NEON_DATABASE_URL || 
                process.env.POSTGRES_URL_NON_POOLING || 
                process.env.DATABASE_URL_UNPOOLED ||
                process.env.POSTGRES_PRISMA_URL;
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

  // Auto-migrate legacy tables if they exist and zentrapesa_ tables do not
  const legacyTables = ['users', 'trades', 'deposits', 'withdrawals', 'messages', 'settings'];
  for (const t of legacyTables) {
    try {
      const checkLegacy = await db`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = ${t}
        ) AS has_legacy
      `;
      const checkMali = await db`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = ${'malicrush_' + t}
        ) AS has_mali
      `;
      const checkNew = await db`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = ${'zentrapesa_' + t}
        ) AS has_new
      `;
      if (!checkNew[0]?.has_new) {
        if (checkMali[0]?.has_mali) {
          if (t === 'users') await db`ALTER TABLE malicrush_users RENAME TO zentrapesa_users`;
          else if (t === 'trades') await db`ALTER TABLE malicrush_trades RENAME TO zentrapesa_trades`;
          else if (t === 'deposits') await db`ALTER TABLE malicrush_deposits RENAME TO zentrapesa_deposits`;
          else if (t === 'withdrawals') await db`ALTER TABLE malicrush_withdrawals RENAME TO zentrapesa_withdrawals`;
          else if (t === 'messages') await db`ALTER TABLE malicrush_messages RENAME TO zentrapesa_messages`;
          else if (t === 'settings') await db`ALTER TABLE malicrush_settings RENAME TO zentrapesa_settings`;
        } else if (checkLegacy[0]?.has_legacy) {
          if (t === 'users') await db`ALTER TABLE users RENAME TO zentrapesa_users`;
          else if (t === 'trades') await db`ALTER TABLE trades RENAME TO zentrapesa_trades`;
          else if (t === 'deposits') await db`ALTER TABLE deposits RENAME TO zentrapesa_deposits`;
          else if (t === 'withdrawals') await db`ALTER TABLE withdrawals RENAME TO zentrapesa_withdrawals`;
          else if (t === 'messages') await db`ALTER TABLE messages RENAME TO zentrapesa_messages`;
          else if (t === 'settings') await db`ALTER TABLE settings RENAME TO zentrapesa_settings`;
        }
      }
    } catch (migErr) {
      // Ignore migration errors and proceed to CREATE IF NOT EXISTS
    }
  }

  // 1. zentrapesa_users
  try {
    await db`
      CREATE TABLE IF NOT EXISTS zentrapesa_users (
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
    await db`ALTER TABLE zentrapesa_users ADD COLUMN IF NOT EXISTS username VARCHAR(100)`;
    await db`ALTER TABLE zentrapesa_users ADD COLUMN IF NOT EXISTS name VARCHAR(100)`;
    await db`ALTER TABLE zentrapesa_users ADD COLUMN IF NOT EXISTS email VARCHAR(100)`;
    await db`ALTER TABLE zentrapesa_users ADD COLUMN IF NOT EXISTS phone VARCHAR(50) DEFAULT ''`;
    await db`ALTER TABLE zentrapesa_users ADD COLUMN IF NOT EXISTS password VARCHAR(255) DEFAULT ''`;
    await db`ALTER TABLE zentrapesa_users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255) DEFAULT ''`;
    await db`ALTER TABLE zentrapesa_users ADD COLUMN IF NOT EXISTS balance NUMERIC(12,2) DEFAULT 0.00`;
    await db`ALTER TABLE zentrapesa_users ADD COLUMN IF NOT EXISTS demo_balance NUMERIC(12,2) DEFAULT 10000.00`;
    await db`ALTER TABLE zentrapesa_users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user'`;
    await db`ALTER TABLE zentrapesa_users ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'`;
    await db`ALTER TABLE zentrapesa_users ADD COLUMN IF NOT EXISTS has_app BOOLEAN DEFAULT FALSE`;
    await db`ALTER TABLE zentrapesa_users ADD COLUMN IF NOT EXISTS app_installed_at TIMESTAMP WITH TIME ZONE`;
    await db`ALTER TABLE zentrapesa_users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`;
    await db`ALTER TABLE zentrapesa_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`;

    try { await db`ALTER TABLE zentrapesa_users ALTER COLUMN name DROP NOT NULL`; } catch (e) {}
    try { await db`ALTER TABLE zentrapesa_users ALTER COLUMN password_hash DROP NOT NULL`; } catch (e) {}
    try { await db`ALTER TABLE zentrapesa_users ALTER COLUMN password DROP NOT NULL`; } catch (e) {}
    try { await db`ALTER TABLE zentrapesa_users ALTER COLUMN phone DROP NOT NULL`; } catch (e) {}

    // Ensure ID column has an auto-increment sequence
    try {
      await db`CREATE SEQUENCE IF NOT EXISTS zentrapesa_users_id_seq`;
      await db`ALTER TABLE zentrapesa_users ALTER COLUMN id SET DEFAULT nextval('zentrapesa_users_id_seq')`;
      await db`ALTER SEQUENCE zentrapesa_users_id_seq OWNED BY zentrapesa_users.id`;
    } catch (seqErr) {}

    // Ensure Unique Indexes exist
    try {
      await db`CREATE UNIQUE INDEX IF NOT EXISTS zentrapesa_users_username_idx ON zentrapesa_users (username)`;
      await db`CREATE UNIQUE INDEX IF NOT EXISTS zentrapesa_users_email_idx ON zentrapesa_users (email)`;
    } catch (idxErr) {}
  } catch (e) { console.error('Error creating/migrating zentrapesa_users table:', e); }

  // 2. zentrapesa_trades
  try {
    await db`
      CREATE TABLE IF NOT EXISTS zentrapesa_trades (
        id SERIAL PRIMARY KEY,
        trade_ref VARCHAR(50) NOT NULL UNIQUE,
        user_id INT NOT NULL REFERENCES zentrapesa_users(id) ON DELETE CASCADE,
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
  } catch (e) { console.error('Error creating zentrapesa_trades table:', e); }

  // 3. zentrapesa_deposits
  try {
    await db`
      CREATE TABLE IF NOT EXISTS zentrapesa_deposits (
        id SERIAL PRIMARY KEY,
        deposit_ref VARCHAR(100) NOT NULL UNIQUE,
        checkout_request_id VARCHAR(100) DEFAULT '',
        username VARCHAR(100),
        amount_kes NUMERIC(12,2) NOT NULL DEFAULT 0.00,
        amount_usd NUMERIC(12,2),
        currency VARCHAR(10) NOT NULL DEFAULT 'kes',
        method VARCHAR(100) NOT NULL DEFAULT 'mpesa',
        phone VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        credited BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Ensure all columns exist
    await db`ALTER TABLE zentrapesa_deposits ADD COLUMN IF NOT EXISTS checkout_request_id VARCHAR(100) DEFAULT ''`;
    await db`ALTER TABLE zentrapesa_deposits ADD COLUMN IF NOT EXISTS username VARCHAR(100)`;
    await db`ALTER TABLE zentrapesa_deposits ADD COLUMN IF NOT EXISTS amount_kes NUMERIC(12,2) DEFAULT 0.00`;
    await db`ALTER TABLE zentrapesa_deposits ADD COLUMN IF NOT EXISTS amount_usd NUMERIC(12,2)`;
    await db`ALTER TABLE zentrapesa_deposits ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'kes'`;
    await db`ALTER TABLE zentrapesa_deposits ADD COLUMN IF NOT EXISTS method VARCHAR(100) DEFAULT 'mpesa'`;
    await db`ALTER TABLE zentrapesa_deposits ADD COLUMN IF NOT EXISTS phone VARCHAR(50) DEFAULT ''`;
    await db`ALTER TABLE zentrapesa_deposits ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending'`;
    await db`ALTER TABLE zentrapesa_deposits ADD COLUMN IF NOT EXISTS credited BOOLEAN DEFAULT FALSE`;
    await db`ALTER TABLE zentrapesa_deposits ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`;
    try { await db`CREATE INDEX IF NOT EXISTS zentrapesa_deposits_checkout_req_idx ON zentrapesa_deposits (checkout_request_id)`; } catch(e) {}
    try { await db`CREATE INDEX IF NOT EXISTS zentrapesa_deposits_method_idx ON zentrapesa_deposits (method)`; } catch(e) {}
    try { await db`CREATE INDEX IF NOT EXISTS zentrapesa_deposits_phone_idx ON zentrapesa_deposits (phone)`; } catch(e) {}
  } catch (e) { console.error('Error creating zentrapesa_deposits table:', e); }

  // 4. zentrapesa_withdrawals
  try {
    await db`
      CREATE TABLE IF NOT EXISTS zentrapesa_withdrawals (
        id SERIAL PRIMARY KEY,
        withdraw_ref VARCHAR(50) NOT NULL UNIQUE,
        username VARCHAR(50),
        amount_kes NUMERIC(10,2) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;
  } catch (e) { console.error('Error creating zentrapesa_withdrawals table:', e); }

  // 5. zentrapesa_messages
  try {
    await db`
      CREATE TABLE IF NOT EXISTS zentrapesa_messages (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(100),
        username VARCHAR(50),
        title VARCHAR(50) NOT NULL DEFAULT 'MPESA',
        body TEXT NOT NULL,
        read BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await db`ALTER TABLE zentrapesa_messages ADD COLUMN IF NOT EXISTS username VARCHAR(50)`;
    await db`ALTER TABLE zentrapesa_messages ADD COLUMN IF NOT EXISTS user_id VARCHAR(100)`;
    await db`ALTER TABLE zentrapesa_messages ADD COLUMN IF NOT EXISTS title VARCHAR(50) DEFAULT 'MPESA'`;
    await db`ALTER TABLE zentrapesa_messages ADD COLUMN IF NOT EXISTS body TEXT DEFAULT ''`;
    await db`ALTER TABLE zentrapesa_messages ADD COLUMN IF NOT EXISTS read BOOLEAN DEFAULT FALSE`;
    await db`ALTER TABLE zentrapesa_messages ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`;
    try {
      await db`DELETE FROM zentrapesa_messages WHERE body LIKE 'Payment Confirmed.%'`;
    } catch(e) {}
  } catch (e) { console.error('Error creating zentrapesa_messages table:', e); }

  // 6. zentrapesa_settings
  try {
    await db`
      CREATE TABLE IF NOT EXISTS zentrapesa_settings (
        key VARCHAR(50) PRIMARY KEY,
        value TEXT NOT NULL
      )
    `;
  } catch (e) { console.error('Error creating zentrapesa_settings table:', e); }

  // Seed default admin and traders if table is empty
  try {
    const userCountRes = await db`SELECT COUNT(*) AS cnt FROM zentrapesa_users`;
    const count = parseInt(userCountRes[0]?.cnt || 0);
    if (count < 2) {
      await db`
        INSERT INTO zentrapesa_users (username, name, email, phone, password_hash, password, balance, demo_balance, role, status)
        VALUES 
          ('admin', 'Admin Core', 'admin@zentrapesa.com', '254700000000', 'Aa@22', 'Aa@22', 500000.00, 100000.00, 'admin', 'active'),
          ('trader254', 'Brian Kip', 'trader254@gmail.com', '254712345678', 'Aa@22', 'Aa@22', 2500.00, 10000.00, 'user', 'active'),
          ('kamau_fx', 'John Kamau', 'kamau@gmail.com', '254722114455', 'Aa@22', 'Aa@22', 8750.00, 10000.00, 'user', 'active'),
          ('sarah_w', 'Sarah Wanjiru', 'sarah.w@yahoo.com', '254733889900', 'Aa@22', 'Aa@22', 14200.00, 10000.00, 'user', 'active'),
          ('mwangi_trade', 'Peter Mwangi', 'pmwangi@gmail.com', '254799443322', 'Aa@22', 'Aa@22', 600.00, 10000.00, 'user', 'active')
        ON CONFLICT (username) DO NOTHING
      `;
    }
    // Ensure admin user password is synchronized to Aa@22 in Neon DB
    await db`
      UPDATE zentrapesa_users 
      SET password = 'Aa@22', password_hash = 'Aa@22' 
      WHERE LOWER(username) = 'admin' OR LOWER(email) = 'admin@zentrapesa.com'
    `;
  } catch (e) {
    console.error('Error seeding active traders in initDb:', e);
  }

  isInitialized = true;
}

-- MaliCrush PostgreSQL Schema for Neon Database

-- 1. Users Table
CREATE TABLE IF NOT EXISTS malicrush_users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(100),
  email VARCHAR(100) NOT NULL UNIQUE,
  phone VARCHAR(50) DEFAULT '',
  password VARCHAR(255) DEFAULT '',
  password_hash VARCHAR(255) DEFAULT '',
  balance NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  demo_balance NUMERIC(12,2) NOT NULL DEFAULT 10000.00,
  role VARCHAR(20) NOT NULL DEFAULT 'user',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Ensure all columns exist in malicrush_users table
ALTER TABLE malicrush_users ADD COLUMN IF NOT EXISTS username VARCHAR(50);
ALTER TABLE malicrush_users ADD COLUMN IF NOT EXISTS name VARCHAR(100);
ALTER TABLE malicrush_users ADD COLUMN IF NOT EXISTS email VARCHAR(100);
ALTER TABLE malicrush_users ADD COLUMN IF NOT EXISTS phone VARCHAR(50) DEFAULT '';
ALTER TABLE malicrush_users ADD COLUMN IF NOT EXISTS password VARCHAR(255) DEFAULT '';
ALTER TABLE malicrush_users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255) DEFAULT '';
ALTER TABLE malicrush_users ADD COLUMN IF NOT EXISTS balance NUMERIC(12,2) DEFAULT 0.00;
ALTER TABLE malicrush_users ADD COLUMN IF NOT EXISTS demo_balance NUMERIC(12,2) DEFAULT 10000.00;
ALTER TABLE malicrush_users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user';
ALTER TABLE malicrush_users ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';
ALTER TABLE malicrush_users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE malicrush_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

-- 2. Trades Table
CREATE TABLE IF NOT EXISTS malicrush_trades (
  id SERIAL PRIMARY KEY,
  trade_ref VARCHAR(50) NOT NULL UNIQUE,
  user_id INT NOT NULL REFERENCES malicrush_users(id) ON DELETE CASCADE,
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
);

-- 3. Deposits Table
CREATE TABLE IF NOT EXISTS malicrush_deposits (
  id SERIAL PRIMARY KEY,
  deposit_ref VARCHAR(50) NOT NULL UNIQUE,
  user_id INT REFERENCES malicrush_users(id) ON DELETE SET NULL,
  username VARCHAR(50),
  amount_kes NUMERIC(10,2) NOT NULL,
  amount_usd NUMERIC(10,2),
  currency VARCHAR(10) NOT NULL DEFAULT 'kes',
  method VARCHAR(30) NOT NULL DEFAULT 'mpesa',
  phone VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Withdrawals Table
CREATE TABLE IF NOT EXISTS malicrush_withdrawals (
  id SERIAL PRIMARY KEY,
  withdraw_ref VARCHAR(50) NOT NULL UNIQUE,
  user_id INT REFERENCES malicrush_users(id) ON DELETE SET NULL,
  username VARCHAR(50),
  amount_kes NUMERIC(10,2) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Messages Table
CREATE TABLE IF NOT EXISTS malicrush_messages (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(100),
  username VARCHAR(50),
  title VARCHAR(50) NOT NULL DEFAULT 'MPESA',
  body TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Platform Settings Table
CREATE TABLE IF NOT EXISTS malicrush_settings (
  key VARCHAR(50) PRIMARY KEY,
  value TEXT NOT NULL
);

-- Seed Default Admin Account (password: Aa@123)
INSERT INTO malicrush_users (username, name, email, phone, password_hash, password, balance, demo_balance, role)
VALUES ('admin', 'Admin Core', 'admin@malicrush.com', '254700000000', 'Aa@123', 'Aa@123', 500000.00, 100000.00, 'admin')
ON CONFLICT (username) DO NOTHING;

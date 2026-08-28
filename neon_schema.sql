-- ==========================================================
-- VexPesa Standalone PostgreSQL Schema for Neon Database
-- This creates independent vexpesa_* tables without touching
-- any existing zentrapesa_* tables or data in the database.
-- ==========================================================

-- 1. Users Table (vexpesa_users)
CREATE TABLE IF NOT EXISTS vexpesa_users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(100),
  email VARCHAR(100) NOT NULL UNIQUE,
  phone VARCHAR(50) DEFAULT '',
  password VARCHAR(255) DEFAULT '',
  password_hash VARCHAR(255) DEFAULT '',
  balance NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  demo_balance NUMERIC(12,2) NOT NULL DEFAULT 10000.00,
  role VARCHAR(20) NOT NULL DEFAULT 'user',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  has_app BOOLEAN DEFAULT FALSE,
  app_installed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Ensure all columns exist in vexpesa_users table
ALTER TABLE vexpesa_users ADD COLUMN IF NOT EXISTS username VARCHAR(100);
ALTER TABLE vexpesa_users ADD COLUMN IF NOT EXISTS name VARCHAR(100);
ALTER TABLE vexpesa_users ADD COLUMN IF NOT EXISTS email VARCHAR(100);
ALTER TABLE vexpesa_users ADD COLUMN IF NOT EXISTS phone VARCHAR(50) DEFAULT '';
ALTER TABLE vexpesa_users ADD COLUMN IF NOT EXISTS password VARCHAR(255) DEFAULT '';
ALTER TABLE vexpesa_users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255) DEFAULT '';
ALTER TABLE vexpesa_users ADD COLUMN IF NOT EXISTS balance NUMERIC(12,2) DEFAULT 0.00;
ALTER TABLE vexpesa_users ADD COLUMN IF NOT EXISTS demo_balance NUMERIC(12,2) DEFAULT 10000.00;
ALTER TABLE vexpesa_users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user';
ALTER TABLE vexpesa_users ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';
ALTER TABLE vexpesa_users ADD COLUMN IF NOT EXISTS has_app BOOLEAN DEFAULT FALSE;
ALTER TABLE vexpesa_users ADD COLUMN IF NOT EXISTS app_installed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE vexpesa_users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE vexpesa_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

-- Unique Indexes for Users
CREATE UNIQUE INDEX IF NOT EXISTS vexpesa_users_username_idx ON vexpesa_users (username);
CREATE UNIQUE INDEX IF NOT EXISTS vexpesa_users_email_idx ON vexpesa_users (email);

-- 2. Trades Table (vexpesa_trades)
CREATE TABLE IF NOT EXISTS vexpesa_trades (
  id SERIAL PRIMARY KEY,
  trade_ref VARCHAR(50) NOT NULL UNIQUE,
  user_id INT NOT NULL REFERENCES vexpesa_users(id) ON DELETE CASCADE,
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

-- 3. Deposits Table (vexpesa_deposits)
CREATE TABLE IF NOT EXISTS vexpesa_deposits (
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
);

-- Ensure all columns and indexes exist in vexpesa_deposits
ALTER TABLE vexpesa_deposits ADD COLUMN IF NOT EXISTS checkout_request_id VARCHAR(100) DEFAULT '';
ALTER TABLE vexpesa_deposits ADD COLUMN IF NOT EXISTS username VARCHAR(100);
ALTER TABLE vexpesa_deposits ADD COLUMN IF NOT EXISTS amount_kes NUMERIC(12,2) DEFAULT 0.00;
ALTER TABLE vexpesa_deposits ADD COLUMN IF NOT EXISTS amount_usd NUMERIC(12,2);
ALTER TABLE vexpesa_deposits ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'kes';
ALTER TABLE vexpesa_deposits ADD COLUMN IF NOT EXISTS method VARCHAR(100) DEFAULT 'mpesa';
ALTER TABLE vexpesa_deposits ADD COLUMN IF NOT EXISTS phone VARCHAR(50) DEFAULT '';
ALTER TABLE vexpesa_deposits ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending';
ALTER TABLE vexpesa_deposits ADD COLUMN IF NOT EXISTS credited BOOLEAN DEFAULT FALSE;
ALTER TABLE vexpesa_deposits ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS vexpesa_deposits_checkout_req_idx ON vexpesa_deposits (checkout_request_id);
CREATE INDEX IF NOT EXISTS vexpesa_deposits_method_idx ON vexpesa_deposits (method);
CREATE INDEX IF NOT EXISTS vexpesa_deposits_phone_idx ON vexpesa_deposits (phone);

-- 4. Withdrawals Table (vexpesa_withdrawals)
CREATE TABLE IF NOT EXISTS vexpesa_withdrawals (
  id SERIAL PRIMARY KEY,
  withdraw_ref VARCHAR(50) NOT NULL UNIQUE,
  username VARCHAR(50),
  amount_kes NUMERIC(10,2) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Messages Table (vexpesa_messages)
CREATE TABLE IF NOT EXISTS vexpesa_messages (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(100),
  username VARCHAR(50),
  title VARCHAR(50) NOT NULL DEFAULT 'MPESA',
  body TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE vexpesa_messages ADD COLUMN IF NOT EXISTS username VARCHAR(50);
ALTER TABLE vexpesa_messages ADD COLUMN IF NOT EXISTS user_id VARCHAR(100);
ALTER TABLE vexpesa_messages ADD COLUMN IF NOT EXISTS title VARCHAR(50) DEFAULT 'MPESA';
ALTER TABLE vexpesa_messages ADD COLUMN IF NOT EXISTS body TEXT DEFAULT '';
ALTER TABLE vexpesa_messages ADD COLUMN IF NOT EXISTS read BOOLEAN DEFAULT FALSE;
ALTER TABLE vexpesa_messages ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

-- 6. Platform Settings Table (vexpesa_settings)
CREATE TABLE IF NOT EXISTS vexpesa_settings (
  key VARCHAR(50) PRIMARY KEY,
  value TEXT NOT NULL
);

-- 7. Seed Default Admin and Traders for VexPesa
INSERT INTO vexpesa_users (username, name, email, phone, password_hash, password, balance, demo_balance, role, status)
VALUES 
  ('admin', 'Admin Core', 'admin@vexpesa.com', '254700000000', 'Aa@22', 'Aa@22', 500000.00, 100000.00, 'admin', 'active'),
  ('trader254', 'Brian Kip', 'trader254@gmail.com', '254712345678', 'Aa@22', 'Aa@22', 2500.00, 10000.00, 'user', 'active'),
  ('kamau_fx', 'John Kamau', 'kamau@gmail.com', '254722114455', 'Aa@22', 'Aa@22', 8750.00, 10000.00, 'user', 'active'),
  ('sarah_w', 'Sarah Wanjiru', 'sarah.w@yahoo.com', '254733889900', 'Aa@22', 'Aa@22', 14200.00, 10000.00, 'user', 'active'),
  ('mwangi_trade', 'Peter Mwangi', 'pmwangi@gmail.com', '254799443322', 'Aa@22', 'Aa@22', 600.00, 10000.00, 'user', 'active')
ON CONFLICT (username) DO UPDATE 
SET password = EXCLUDED.password, password_hash = EXCLUDED.password_hash;

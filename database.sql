-- MaliCrush Database Schema
-- Compatible with MySQL 5.7+ / MariaDB / Cloud SQL

CREATE DATABASE IF NOT EXISTS `malicrush` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `malicrush`;

-- 1. Users Table
CREATE TABLE IF NOT EXISTS `malicrush_users` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `username` VARCHAR(50) NOT NULL UNIQUE,
  `name` VARCHAR(100) NULL,
  `email` VARCHAR(100) NOT NULL UNIQUE,
  `phone` VARCHAR(20) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `password` VARCHAR(255) NULL,
  `balance` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `demo_balance` DECIMAL(12,2) NOT NULL DEFAULT 10000.00,
  `role` ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  `status` ENUM('active', 'suspended') NOT NULL DEFAULT 'active',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 2. Trades Table
CREATE TABLE IF NOT EXISTS `malicrush_trades` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `trade_ref` VARCHAR(50) NOT NULL UNIQUE,
  `user_id` INT UNSIGNED NOT NULL,
  `trade_type` ENUM('buy', 'sell') NOT NULL,
  `stake` DECIMAL(10,2) NOT NULL,
  `entry_rate` DECIMAL(10,4) NOT NULL,
  `exit_rate` DECIMAL(10,4) NULL,
  `multiplier` DECIMAL(6,2) NULL,
  `payout` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `result` ENUM('pending', 'win', 'lose', 'cancelled') NOT NULL DEFAULT 'pending',
  `is_demo` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `resolved_at` TIMESTAMP NULL,
  FOREIGN KEY (`user_id`) REFERENCES `malicrush_users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 3. Deposits Table
CREATE TABLE IF NOT EXISTS `malicrush_deposits` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `deposit_ref` VARCHAR(50) NOT NULL UNIQUE,
  `user_id` INT UNSIGNED NULL,
  `username` VARCHAR(50) NULL,
  `amount_kes` DECIMAL(10,2) NOT NULL,
  `amount_usd` DECIMAL(10,2) NULL,
  `currency` ENUM('kes', 'usd') NOT NULL DEFAULT 'kes',
  `method` ENUM('mpesa', 'pesapal', 'hub', 'megapay', 'paywave', 'payhero') NOT NULL DEFAULT 'mpesa',
  `phone` VARCHAR(20) NOT NULL,
  `status` ENUM('pending', 'completed', 'failed') NOT NULL DEFAULT 'pending',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `malicrush_users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 4. Withdrawals Table
CREATE TABLE IF NOT EXISTS `malicrush_withdrawals` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `withdraw_ref` VARCHAR(50) NOT NULL UNIQUE,
  `user_id` INT UNSIGNED NULL,
  `username` VARCHAR(50) NULL,
  `amount_kes` DECIMAL(10,2) NOT NULL,
  `phone` VARCHAR(20) NOT NULL,
  `status` ENUM('pending', 'processed', 'rejected') NOT NULL DEFAULT 'pending',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `malicrush_users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 5. Messages Table
CREATE TABLE IF NOT EXISTS `malicrush_messages` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id` VARCHAR(100) NULL,
  `username` VARCHAR(50) NULL,
  `title` VARCHAR(50) NOT NULL DEFAULT 'MPESA',
  `body` TEXT NOT NULL,
  `read` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 6. Platform Settings Table
CREATE TABLE IF NOT EXISTS `malicrush_settings` (
  `key` VARCHAR(50) PRIMARY KEY,
  `value` TEXT NOT NULL
) ENGINE=InnoDB;

-- Seed Default Settings
INSERT INTO `malicrush_settings` (`key`, `value`) VALUES
('graph_speed', '300'),
('graph_y_max', '0.12'),
('graph_spike_freq', '0.10'),
('graph_crash_freq', '0.02'),
('graph_base_level', '0.025'),
('graph_spike_max', '0.105'),
('graph_crash_depth', '-0.17'),
('trade_duration', '60'),
('trade_min_stake', '10'),
('trade_max_stake', '50000'),
('trade_max_multiplier', '5.0'),
('trade_prestart_wait', '3'),
('trade_autosell_multiplier', '2.5'),
('usd_rate', '129.00'),
('deposit_currency', 'kes'),
('checkout_method', 'both')
ON DUPLICATE KEY UPDATE `value`=VALUES(`value`);

-- Seed Default Admin Account (password: Aa@123)
INSERT INTO `malicrush_users` (`username`, `name`, `email`, `phone`, `password_hash`, `password`, `balance`, `demo_balance`, `role`) VALUES
('admin', 'Admin Core', 'admin@malicrush.com', '254700000000', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Aa@123', 500000.00, 100000.00, 'admin')
ON DUPLICATE KEY UPDATE `username`=VALUES(`username`);

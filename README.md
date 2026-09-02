# VexPesa — Next-Gen Fast-Paced Binary Trading Platform

> **VexPesa** — *Trade Smart, Earn Big.*

A high-performance, real-time spike trading platform built with a canvas-rendered quadratic Bezier price engine, multi-stage trade execution, live activity community chat, multi-currency deposit system (KES & USD), M-Pesa STK Push / PesaPal checkout, withdrawal management, and admin control dashboard.

---

## 🌟 Key Features

### 1. Real-Time Canvas Spike Trading Engine
- High-frame-rate HTML5 Canvas graph with smooth Bezier curve interpolation.
- Visual zones: vibrant green fill above zero line and deep crimson fill below zero line.
- Dynamic glowing rate indicator, entry guidelines, and live rate box.
- Timeframe options: `30s`, `1m` (default), `2m`, `5m`.
- Realistic price engine generating spike clusters, micro-jitters, dips, and recovery waves.

### 2. Multi-Stage Trade Execution
- **Real Mode** and **Demo Mode** toggle (virtual KES 10,000 balance).
- Quick stake buttons (`50`, `100`, `200`, `500`) and custom stake inputs.
- **Prestart Phase**: Configurable cancel window (e.g. 3s) allowing full refund on cancel.
- **Active Phase**: Dynamic multiplier (`×1.00` to `×5.00`), live P&L, secondary button converting to `CASHOUT`.
- **Auto-Resolve**: Instant autosell at multiplier target (e.g. `×2.5`), auto-loss on crash below zero, and expiry countdown.
- **Celebration FX**: Web Audio API sound synthesis, confetti, and floating balloons on winning trades.

### 3. Multi-Currency Deposit & Withdrawal Engine
- **Currencies**: KES & USD with live admin exchange rate conversion.
- **Gateways**: Safaricom M-Pesa STK Push, PesaPal Secure Iframe Modal, Hub, MegaPay, PayWave.
- **Withdrawals**: Direct instant M-Pesa B2C withdrawal system with real-time balance validation.

### 4. Community Live Activity Chat
- Real-time trader counter with realistic fluctuating active user presence.
- Automated streaming feed of trader wins, bonuses, and community interactions.
- User input to participate in the live feed.
- Mobile drawer support for small screens.

### 5. Admin Control Portal (`/admin/`)
- Real-time configuration of price engine speed, spike frequency, crash frequency, and bounds.
- Trade limits: min/max stake, max multiplier cap, prestart window, autosell multiplier.
- Exchange rate & payment gateway controls.
- User and ledger management.

---

## 📁 File Structure

```
vexpesa/
├── index.html              # Primary VexPesa Trading Dashboard (Static / Standalone)
├── login.html              # User Login Screen
├── register.html           # User Registration Screen (+254 phone validation)
├── profile.html            # Profile, Wallet, and Balance Management
├── transactions.html       # Trade & Transaction History Ledger
├── messages.html           # Messages & SMS Alert Interface
├── neon_schema.sql         # PostgreSQL Schema for Neon Database
├── database.sql            # Full MySQL Schema & Seed Data
├── README.md               # Documentation
│
├── admin/
│   ├── index.html          # Admin Control Dashboard
│   └── login.html          # Admin Authentication Portal
│
└── api/
    ├── db.js               # Database Connection & Migration Logic
    ├── auth.js             # Authentication API
    ├── users.js            # User Management API
    ├── trade.js            # Trade Placement & Resolution API
    ├── stk-push.js         # M-Pesa STK Push Simulation & Handler
    ├── deposits.js         # Deposit Processing API
    ├── withdraw.js         # M-Pesa Withdrawal Handler
    ├── messages.js         # Notifications & SMS API
    └── settings.js         # Platform Settings API
```

---

## 🚀 Running the Project

### Standalone / Static Browser Mode
Double click or open `index.html` directly in any web browser. The application includes full client-side state simulation and `localStorage` persistence for balances, trades, deposits, withdrawals, and settings.

### Serverless / Node.js & Vercel Deployment
1. Set up your Vercel Project and add the following Environment Variables in **Vercel Project Settings -> Environment Variables**:
   ```env
   # Database
   DATABASE_URL=postgresql://neondb_owner:...@ep-...neon.tech/neondb?sslmode=require

   # Admin Authentication
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=your_secure_custom_password_here
   ADMIN_JWT_SECRET=your_32_character_random_secret_here

   # Primary Payment Gateway (GravityPay)
   GRAVITYPAY_API_KEY=your_gravitypay_api_key
   GRAVITYPAY_SECRET_KEY=your_gravitypay_secret_key
   GRAVITYPAY_WEBHOOK_SECRET=your_gravitypay_webhook_secret
   GRAVITYPAY_CALLBACK_URL=https://yourdomain.com/api/webhooks/gravitypay

   # Secondary Gateway (PayHero)
   PAYHERO_API_USERNAME=your_payhero_username
   PAYHERO_API_PASSWORD=your_payhero_password
   PAYHERO_CHANNEL_ID=your_channel_id
   PAYHERO_CALLBACK_URL=https://yourdomain.com/api/webhooks/payhero

   PAYMENT_GATEWAY=gravitypay
   ```

2. Access:
   - **User Platform**: `https://yourdomain.com/`
   - **Admin Portal**: `https://yourdomain.com/admin/login.html`

---

## 🔐 Security Architecture

- **Protected Admin API**: All admin routes (`/api/settings`, `/api/users`, `/api/deposits`) require a cryptographically signed HMAC-SHA256 session token (`Authorization: Bearer <token>`).
- **Zero Client Credential Leakage**: Gateway API keys and secrets are strictly retained on the backend runtime and never sent to or returned to client browsers.
- **Environment Driven**: Gateway credentials and master admin authentication are managed securely via Vercel Environment Variables.

---

## 📜 Regulatory Notice
Licensed and regulated in the Commonwealth of The Bahamas under licence number `BHA-0023-1873201`.

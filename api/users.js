import { getDb, initDb } from './db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  await initDb();
  const db = getDb();

  // 1. GET ALL TRADERS & STATS
  if (req.method === 'GET') {
    if (db) {
      try {
        const users = await db`
          SELECT id, username, email, phone, balance, demo_balance, role, status, created_at
          FROM users
          ORDER BY created_at DESC
        `;

        const totalVolRes = await db`SELECT COALESCE(SUM(stake), 0) AS total_vol FROM trades`;
        const totalPayRes = await db`SELECT COALESCE(SUM(payout), 0) AS total_payouts FROM trades WHERE result = 'win'`;

        return res.status(200).json({
          success: true,
          connected: true,
          users: users.map(u => ({
            ...u,
            balance: parseFloat(u.balance),
            demo_balance: parseFloat(u.demo_balance)
          })),
          stats: {
            total_traders: users.length,
            total_volume: parseFloat(totalVolRes[0]?.total_vol || 0),
            total_payouts: parseFloat(totalPayRes[0]?.total_payouts || 0)
          }
        });
      } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    // Default simulation if DB not configured yet
    return res.status(200).json({
      success: true,
      connected: false,
      users: [],
      stats: { total_traders: 1284, total_volume: 4820400, total_payouts: 32491000 }
    });
  }

  // 2. POST (Credit balance, update user)
  if (req.method === 'POST') {
    const input = req.body || {};
    const action = input.action || '';
    const userId = parseInt(input.user_id || input.userId);
    const username = input.username || '';

    if (action === 'credit') {
      const amount = parseFloat(input.amount) || 0;
      const type = input.wallet_type || 'real'; // 'real' or 'demo'

      if (amount <= 0) {
        return res.status(400).json({ success: false, error: 'Invalid credit amount' });
      }

      if (db) {
        try {
          if (type === 'demo') {
            await db`
              UPDATE users 
              SET demo_balance = demo_balance + ${amount}, updated_at = CURRENT_TIMESTAMP
              WHERE id = ${userId} OR username = ${username}
            `;
          } else {
            await db`
              UPDATE users 
              SET balance = balance + ${amount}, updated_at = CURRENT_TIMESTAMP
              WHERE id = ${userId} OR username = ${username}
            `;
          }

          // Also record in deposits table
          await db`
            INSERT INTO deposits (deposit_ref, username, amount_kes, phone, method, status)
            VALUES (${'CREDIT-' + Date.now()}, ${username}, ${amount}, 'Admin', 'Admin Credit', 'completed')
          `;

          return res.status(200).json({ success: true, message: `Credited ${amount} to ${username}` });
        } catch (err) {
          return res.status(500).json({ success: false, error: err.message });
        }
      }

      return res.status(200).json({ success: true, message: `Credited ${amount} (Local)` });
    }

    if (action === 'toggle_status') {
      const newStatus = input.status === 'suspended' ? 'suspended' : 'active';
      if (db && userId) {
        try {
          await db`UPDATE users SET status = ${newStatus} WHERE id = ${userId}`;
          return res.status(200).json({ success: true, status: newStatus });
        } catch (err) {
          return res.status(500).json({ success: false, error: err.message });
        }
      }
    }
  }

  return res.status(400).json({ success: false, error: 'Invalid request' });
}

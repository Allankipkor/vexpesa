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
        let users = [];
        try {
          users = await db`
            SELECT id, 
                   COALESCE(username, name, email, 'Trader') AS username, 
                   COALESCE(email, '') AS email, 
                   COALESCE(phone, '') AS phone, 
                   COALESCE(balance, 0.00) AS balance, 
                   COALESCE(demo_balance, 10000.00) AS demo_balance, 
                   COALESCE(role, 'user') AS role, 
                   COALESCE(status, 'active') AS status, 
                   COALESCE(created_at, CURRENT_TIMESTAMP) AS created_at
            FROM zentrapesa_users
            ORDER BY id DESC
          `;
        } catch (qErr) {
          console.error('Initial user query failed, attempting select all:', qErr);
          users = await db`SELECT * FROM zentrapesa_users ORDER BY id DESC`;
        }

        // If no traders in DB, seed active traders
        if (!users || users.length === 0) {
          try {
            await db`
              INSERT INTO zentrapesa_users (username, name, email, phone, password_hash, password, balance, demo_balance, role, status)
              VALUES 
                ('admin', 'Admin Core', 'admin@zentrapesa.com', '254700000000', 'Aa@123', 'Aa@123', 500000.00, 100000.00, 'admin', 'active'),
                ('trader254', 'Brian Kip', 'trader254@gmail.com', '254712345678', 'Aa@123', 'Aa@123', 2500.00, 10000.00, 'user', 'active'),
                ('kamau_fx', 'John Kamau', 'kamau@gmail.com', '254722114455', 'Aa@123', 'Aa@123', 8750.00, 10000.00, 'user', 'active'),
                ('sarah_w', 'Sarah Wanjiru', 'sarah.w@yahoo.com', '254733889900', 'Aa@123', 'Aa@123', 14200.00, 10000.00, 'user', 'active'),
                ('mwangi_trade', 'Peter Mwangi', 'pmwangi@gmail.com', '254799443322', 'Aa@123', 'Aa@123', 600.00, 10000.00, 'user', 'active')
              ON CONFLICT (username) DO NOTHING
            `;
            users = await db`SELECT * FROM zentrapesa_users ORDER BY id DESC`;
          } catch(seedErr) {
            console.error('Error auto-seeding users in api/users.js:', seedErr);
          }
        }

        let totalVol = 4820400;
        let totalPay = 32491000;
        try {
          const totalVolRes = await db`SELECT COALESCE(SUM(stake), 0) AS total_vol FROM zentrapesa_trades`;
          if (totalVolRes && totalVolRes[0]?.total_vol > 0) totalVol = parseFloat(totalVolRes[0].total_vol);
        } catch(e) {}
        try {
          const totalPayRes = await db`SELECT COALESCE(SUM(payout), 0) AS total_payouts FROM zentrapesa_trades WHERE result = 'win'`;
          if (totalPayRes && totalPayRes[0]?.total_payouts > 0) totalPay = parseFloat(totalPayRes[0].total_payouts);
        } catch(e) {}

        return res.status(200).json({
          success: true,
          connected: true,
          users: users.map(u => ({
            id: u.id,
            username: u.username || u.name || u.email?.split('@')[0] || 'Trader',
            email: u.email || '',
            phone: u.phone || '',
            balance: parseFloat(u.balance || 0),
            demo_balance: parseFloat(u.demo_balance || 10000),
            role: u.role || 'user',
            status: u.status || 'active',
            created_at: u.created_at || new Date().toISOString()
          })),
          stats: {
            total_traders: users.length,
            total_volume: totalVol,
            total_payouts: totalPay
          }
        });
      } catch (err) {
        console.error('Error fetching users from DB:', err);
      }
    }

    // Default simulation if DB not configured yet or offline
    return res.status(200).json({
      success: true,
      connected: false,
      users: [
        { id: 1, username: 'trader254', email: 'trader254@gmail.com', phone: '254712345678', balance: 2500.00, demo_balance: 10000.00, role: 'user', status: 'active', created_at: new Date().toISOString() },
        { id: 2, username: 'kamau_fx', email: 'kamau@gmail.com', phone: '254722114455', balance: 8750.00, demo_balance: 10000.00, role: 'user', status: 'active', created_at: new Date().toISOString() },
        { id: 3, username: 'sarah_w', email: 'sarah.w@yahoo.com', phone: '254733889900', balance: 14200.00, demo_balance: 10000.00, role: 'user', status: 'active', created_at: new Date().toISOString() },
        { id: 4, username: 'mwangi_trade', email: 'pmwangi@gmail.com', phone: '254799443322', balance: 600.00, demo_balance: 10000.00, role: 'user', status: 'active', created_at: new Date().toISOString() }
      ],
      stats: { total_traders: 4, total_volume: 4820400, total_payouts: 32491000 }
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
      const username = (input.username || '').trim();
      const rawUserId = (input.user_id || input.userId || '').toString().trim();

      if (amount <= 0) {
        return res.status(400).json({ success: false, error: 'Invalid credit amount' });
      }

      if (db) {
        try {
          if (type === 'demo') {
            if (rawUserId && rawUserId !== 'null' && rawUserId !== 'undefined') {
              await db`
                UPDATE zentrapesa_users 
                SET demo_balance = demo_balance + ${amount}, updated_at = CURRENT_TIMESTAMP
                WHERE id::text = ${rawUserId} OR LOWER(username) = LOWER(${username}) OR LOWER(name) = LOWER(${username})
              `;
            } else {
              await db`
                UPDATE zentrapesa_users 
                SET demo_balance = demo_balance + ${amount}, updated_at = CURRENT_TIMESTAMP
                WHERE LOWER(username) = LOWER(${username}) OR LOWER(name) = LOWER(${username})
              `;
            }
          } else {
            if (rawUserId && rawUserId !== 'null' && rawUserId !== 'undefined') {
              await db`
                UPDATE zentrapesa_users 
                SET balance = balance + ${amount}, updated_at = CURRENT_TIMESTAMP
                WHERE id::text = ${rawUserId} OR LOWER(username) = LOWER(${username}) OR LOWER(name) = LOWER(${username})
              `;
            } else {
              await db`
                UPDATE zentrapesa_users 
                SET balance = balance + ${amount}, updated_at = CURRENT_TIMESTAMP
                WHERE LOWER(username) = LOWER(${username}) OR LOWER(name) = LOWER(${username})
              `;
            }
          }

          // Also record in deposits table
          try {
            await db`
              INSERT INTO zentrapesa_deposits (deposit_ref, username, amount_kes, phone, method, status, credited)
              VALUES (${'CREDIT-' + Date.now()}, ${username}, ${amount}, 'Admin', 'Admin Credit', 'completed', TRUE)
              ON CONFLICT (deposit_ref) DO NOTHING
            `;
          } catch(depErr) {}

          return res.status(200).json({ success: true, message: `Successfully credited ${amount} to ${username}` });
        } catch (err) {
          console.error('Error crediting balance in DB:', err);
          return res.status(500).json({ success: false, error: err.message });
        }
      }

      return res.status(200).json({ success: true, message: `Credited ${amount} (Local)` });
    }

    if (action === 'toggle_status') {
      const newStatus = input.status === 'suspended' ? 'suspended' : 'active';
      if (db && userId) {
        try {
          await db`UPDATE zentrapesa_users SET status = ${newStatus} WHERE id = ${userId}`;
          return res.status(200).json({ success: true, status: newStatus });
        } catch (err) {
          return res.status(500).json({ success: false, error: err.message });
        }
      }
    }
  }

  return res.status(400).json({ success: false, error: 'Invalid request' });
}

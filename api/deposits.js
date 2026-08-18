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

  const action = req.query.action || (req.body ? req.body.action : '') || '';
  const ref = (req.query.reference || req.query.ref || (req.body ? req.body.reference : '') || '').trim();

  // 1. SINGLE DEPOSIT STATUS CHECK (Client Polling)
  if (action === 'check' && ref) {
    if (db) {
      try {
        const rows = await db`SELECT * FROM deposits WHERE deposit_ref = ${ref} LIMIT 1`;
        if (rows.length > 0) {
          const d = rows[0];
          return res.status(200).json({
            success: true,
            status: d.status || 'pending', // 'completed' | 'pending' | 'failed'
            amount: parseFloat(d.amount_kes || 0),
            method: d.method || 'M-Pesa STK',
            deposit_ref: d.deposit_ref
          });
        }
      } catch (err) {
        console.error('Error checking deposit status:', err);
      }
    }
    return res.status(200).json({ success: true, status: 'pending', deposit_ref: ref });
  }

  // 2. GET ALL DEPOSITS & STATS (Strictly Successful Deposits for Admin Ledger)
  if (req.method === 'GET') {
    if (db) {
      try {
        const onlySuccess = req.query.all !== 'true';
        let deposits;
        if (onlySuccess) {
          deposits = await db`
            SELECT id, deposit_ref, username, amount_kes, amount_usd, currency, method, phone, status, created_at
            FROM deposits
            WHERE status = 'completed' OR status = 'success' OR status = 'successful'
            ORDER BY created_at DESC
            LIMIT 100
          `;
        } else {
          deposits = await db`
            SELECT id, deposit_ref, username, amount_kes, amount_usd, currency, method, phone, status, created_at
            FROM deposits
            ORDER BY created_at DESC
            LIMIT 100
          `;
        }

        let totalKes = 0;
        let totalCount = deposits.length;
        try {
          const sumRes = await db`
            SELECT COALESCE(SUM(amount_kes), 0) AS total_kes, COUNT(*) AS cnt 
            FROM deposits 
            WHERE status = 'completed' OR status = 'success' OR status = 'successful'
          `;
          if (sumRes && sumRes.length > 0) {
            totalKes = parseFloat(sumRes[0].total_kes || 0);
            totalCount = parseInt(sumRes[0].cnt || deposits.length);
          }
        } catch (sumErr) {
          totalKes = deposits.reduce((acc, d) => acc + (parseFloat(d.amount_kes) || 0), 0);
        }

        return res.status(200).json({
          success: true,
          deposits: deposits.map(d => ({
            id: d.id,
            deposit_ref: d.deposit_ref || `DEP-${d.id}`,
            username: d.username || 'Trader',
            amount_kes: parseFloat(d.amount_kes || 0),
            amount_usd: d.amount_usd ? parseFloat(d.amount_usd) : null,
            currency: d.currency || 'kes',
            method: d.method || 'M-Pesa STK',
            phone: d.phone || '',
            status: d.status || 'pending',
            created_at: d.created_at || new Date().toISOString()
          })),
          stats: {
            total_deposits_kes: totalKes,
            total_count: totalCount
          }
        });
      } catch (err) {
        console.error('Error fetching deposits:', err);
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    return res.status(200).json({
      success: true,
      deposits: [],
      stats: { total_deposits_kes: 0, total_count: 0 }
    });
  }

  // 2. CREATE OR CONFIRM DEPOSIT
  if (req.method === 'POST') {
    const input = req.body || {};
    const depositRef = input.deposit_ref || input.reference || `DEP-${Date.now()}`;
    const username = (input.username || 'Trader').trim();
    const amountKes = parseFloat(input.amount_kes || input.amount) || 0;
    const amountUsd = input.amount_usd ? parseFloat(input.amount_usd) : null;
    const currency = (input.currency || 'kes').toLowerCase();
    const method = input.method || 'M-Pesa STK';
    // Client submissions default strictly to 'pending' unless admin-authorized
    const status = (input.admin_auth === true || input.admin === true) ? (input.status || 'completed') : 'pending';

    if (amountKes <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid deposit amount' });
    }

    if (db) {
      try {
        // 1. Insert deposit record
        const inserted = await db`
          INSERT INTO deposits (deposit_ref, username, amount_kes, amount_usd, currency, method, phone, status)
          VALUES (${depositRef}, ${username}, ${amountKes}, ${amountUsd}, ${currency}, ${method}, ${phone}, ${status})
          ON CONFLICT (deposit_ref) DO UPDATE 
          SET status = ${status}, amount_kes = ${amountKes}
          RETURNING *
        `;

        // 2. If status is completed (admin authorized), credit user's real balance in users table
        if (status === 'completed' || status === 'success' || status === 'successful') {
          await db`
            UPDATE users 
            SET balance = balance + ${amountKes}, updated_at = CURRENT_TIMESTAMP
            WHERE username = ${username} OR name = ${username} OR phone = ${phone}
          `;
        }

        return res.status(200).json({
          success: true,
          deposit: inserted[0],
          message: `Deposit of KES ${amountKes.toLocaleString()} recorded successfully!`
        });
      } catch (err) {
        console.error('Error inserting deposit:', err);
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Deposit recorded (Local)'
    });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

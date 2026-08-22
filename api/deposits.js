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
  const ref = (req.query.reference || req.query.ref || req.query.checkoutRequestId || (req.body ? req.body.reference : '') || '').trim();
  const queryPhone = (req.query.phone || (req.body ? req.body.phone : '') || '').trim();
  const queryUser = (req.query.username || (req.body ? req.body.username : '') || '').trim();

  // 1. SINGLE DEPOSIT STATUS CHECK (Client Polling & Active Verification)
  if (action === 'check') {
    if (db) {
      try {
        let rows = [];
        if (ref) {
          rows = await db`
            SELECT * FROM malicrush_deposits 
            WHERE deposit_ref = ${ref} 
               OR checkout_request_id = ${ref} 
               OR id::text = ${ref} 
            LIMIT 1
          `;
        }

        // Fallback search by phone or username if ref is not found
        if (rows.length === 0 && (queryPhone || queryUser)) {
          const phone9 = queryPhone.replace(/\D/g, '').slice(-9);
          if (phone9) {
            rows = await db`
              SELECT * FROM malicrush_deposits 
              WHERE phone LIKE ${'%' + phone9}
              ORDER BY created_at DESC 
              LIMIT 1
            `;
          } else if (queryUser && queryUser !== 'Trader') {
            rows = await db`
              SELECT * FROM malicrush_deposits 
              WHERE LOWER(username) = LOWER(${queryUser})
              ORDER BY created_at DESC 
              LIMIT 1
            `;
          }
        }

        if (rows.length > 0) {
          const d = rows[0];

          // If still pending, actively query GravityPay API status check endpoint
          if (d.status === 'pending') {
            try {
              const cfgRows = await db`SELECT value FROM malicrush_settings WHERE key = 'platform_config' LIMIT 1`;
              if (cfgRows.length > 0) {
                const cfg = JSON.parse(cfgRows[0].value);
                const gpKey = (cfg.gravitypayApiKey || cfg.payments?.gravitypay?.api_key || '').trim();
                const gpSec = (cfg.gravitypaySecretKey || cfg.payments?.gravitypay?.secret_key || '').trim();
                
                // Query using checkout_request_id first, then fallback to deposit_ref
                const queryTokens = [d.checkout_request_id, d.deposit_ref, ref].filter(Boolean);
                
                for (const token of queryTokens) {
                  if (!token || !gpKey || !gpSec) continue;
                  try {
                    const gpRes = await fetch(`https://api.gravitypayapp.com/api/v1/stk/status/${encodeURIComponent(token)}`, {
                      headers: {
                        'Authorization': `Bearer ${gpSec}`,
                        'x-api-key': gpKey
                      }
                    });

                    if (gpRes.ok) {
                      const gpJson = await gpRes.json();
                      const gData = gpJson.data || gpJson;
                      const gStat = (gData.status || gpJson.status || '').toLowerCase();
                      const gReceipt = gData.mpesaReceipt || gpJson.mpesaReceipt || gData.mpesa_reference || '';
                      const gAmount = parseFloat(gData.amount || gpJson.amount || d.amount_kes);

                      if (gStat === 'success' || gStat === 'completed' || gStat === 'successful' || gReceipt) {
                        d.status = 'completed';
                        d.amount_kes = gAmount;
                        d.method = gReceipt ? `M-Pesa (${gReceipt})` : (d.method || 'M-Pesa (GravityPay)');
                        await db`
                          UPDATE malicrush_deposits 
                          SET status = 'completed', 
                              amount_kes = ${gAmount},
                              method = ${d.method}
                          WHERE id = ${d.id}
                        `;
                        break;
                      } else if (gStat === 'failed' || gStat === 'cancelled') {
                        d.status = 'failed';
                        await db`UPDATE malicrush_deposits SET status = 'failed' WHERE id = ${d.id}`;
                        break;
                      }
                    }
                  } catch (e) {}
                }
              }
            } catch (gpErr) {
              console.error('Error querying GravityPay status in polling:', gpErr);
            }
          }

          const isCompleted = d.status === 'completed' || d.status === 'success' || d.status === 'successful';
          let currentBal = null;

          // If completed and not marked credited yet, credit user atomically right now
          if (isCompleted && parseFloat(d.amount_kes) > 0 && !d.credited) {
            const uName = d.username;
            const uPhone = (d.phone || queryPhone || '').replace(/\D/g, '').slice(-9);
            const amt = parseFloat(d.amount_kes);

            let credited = false;
            if (uName && uName !== 'Trader') {
              const uRes = await db`
                UPDATE malicrush_users 
                SET balance = balance + ${amt}, updated_at = CURRENT_TIMESTAMP
                WHERE LOWER(username) = LOWER(${uName}) 
                   OR LOWER(name) = LOWER(${uName}) 
                   OR LOWER(email) = LOWER(${uName})
                RETURNING id, balance
              `;
              if (uRes.length > 0) {
                credited = true;
                currentBal = parseFloat(uRes[0].balance || 0);
              }
            }

            if (!credited && uPhone) {
              const uRes = await db`
                UPDATE malicrush_users 
                SET balance = balance + ${amt}, updated_at = CURRENT_TIMESTAMP
                WHERE phone LIKE ${'%' + uPhone}
                RETURNING id, balance
              `;
              if (uRes.length > 0) {
                currentBal = parseFloat(uRes[0].balance || 0);
              }
            }

            await db`UPDATE malicrush_deposits SET credited = TRUE WHERE id = ${d.id}`;

            // Create M-Pesa receipt message
            try {
              await db`
                INSERT INTO malicrush_messages (user_id, username, title, body, read)
                VALUES (
                  ${uName || d.phone || 'Trader'},
                  ${uName || 'Trader'},
                  'MPESA',
                  ${`Payment Confirmed. Ksh${amt.toFixed(2)} received on ${new Date().toLocaleDateString('en-GB')}. Thank you for using MaliCrush.`},
                  FALSE
                )
              `;
            } catch(mErr) {}
          }

          // If already credited, get latest user balance
          if (isCompleted && currentBal === null) {
            try {
              const uName = d.username;
              const uPhone = (d.phone || '').replace(/\D/g, '').slice(-9);
              let uRes = [];
              if (uName && uName !== 'Trader') {
                uRes = await db`SELECT balance FROM malicrush_users WHERE LOWER(username) = LOWER(${uName}) LIMIT 1`;
              }
              if (uRes.length === 0 && uPhone) {
                uRes = await db`SELECT balance FROM malicrush_users WHERE phone LIKE ${'%' + uPhone} LIMIT 1`;
              }
              if (uRes.length > 0) currentBal = parseFloat(uRes[0].balance || 0);
            } catch(e) {}
          }

          return res.status(200).json({
            success: true,
            status: d.status || 'pending',
            amount: parseFloat(d.amount_kes || 0),
            method: d.method || 'M-Pesa STK',
            deposit_ref: d.deposit_ref,
            balance: currentBal
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
            SELECT id, deposit_ref, checkout_request_id, username, amount_kes, amount_usd, currency, method, phone, status, credited, created_at
            FROM malicrush_deposits
            WHERE status = 'completed' OR status = 'success' OR status = 'successful'
            ORDER BY created_at DESC
            LIMIT 100
          `;
        } else {
          deposits = await db`
            SELECT id, deposit_ref, checkout_request_id, username, amount_kes, amount_usd, currency, method, phone, status, credited, created_at
            FROM malicrush_deposits
            ORDER BY created_at DESC
            LIMIT 100
          `;
        }

        let totalKes = 0;
        let totalCount = deposits.length;
        try {
          const sumRes = await db`
            SELECT COALESCE(SUM(amount_kes), 0) AS total_kes, COUNT(*) AS cnt 
            FROM malicrush_deposits 
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
            checkout_request_id: d.checkout_request_id || '',
            username: d.username || 'Trader',
            amount_kes: parseFloat(d.amount_kes || 0),
            amount_usd: d.amount_usd ? parseFloat(d.amount_usd) : null,
            currency: d.currency || 'kes',
            method: d.method || 'M-Pesa STK',
            phone: d.phone || '',
            status: d.status || 'pending',
            credited: d.credited || false,
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

  // 3. CREATE OR CONFIRM DEPOSIT
  if (req.method === 'POST') {
    const input = req.body || {};
    const depositRef = input.deposit_ref || input.reference || `DEP-${Date.now()}`;
    const checkoutRequestId = input.checkout_request_id || input.checkoutRequestId || '';
    const username = (input.username || 'Trader').trim();
    const phone = (input.phone || '').trim();
    const amountKes = parseFloat(input.amount_kes || input.amount) || 0;
    const amountUsd = input.amount_usd ? parseFloat(input.amount_usd) : null;
    const currency = (input.currency || 'kes').toLowerCase();
    const method = input.method || 'M-Pesa STK';
    const status = (input.admin_auth === true || input.admin === true) ? (input.status || 'completed') : 'pending';
    const isCompleted = status === 'completed' || status === 'success' || status === 'successful';

    if (amountKes <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid deposit amount' });
    }

    if (db) {
      try {
        const inserted = await db`
          INSERT INTO malicrush_deposits (deposit_ref, checkout_request_id, username, amount_kes, amount_usd, currency, method, phone, status, credited)
          VALUES (${depositRef}, ${checkoutRequestId}, ${username}, ${amountKes}, ${amountUsd}, ${currency}, ${method}, ${phone}, ${status}, ${isCompleted})
          ON CONFLICT (deposit_ref) DO UPDATE 
          SET status = ${status}, amount_kes = ${amountKes}, credited = ${isCompleted}, checkout_request_id = ${checkoutRequestId}
          RETURNING *
        `;

        if (isCompleted) {
          const phone9 = phone.replace(/\D/g, '').slice(-9);
          let credited = false;
          if (username && username !== 'Trader') {
            const uRes = await db`
              UPDATE malicrush_users 
              SET balance = balance + ${amountKes}, updated_at = CURRENT_TIMESTAMP
              WHERE LOWER(username) = LOWER(${username}) 
                 OR LOWER(name) = LOWER(${username}) 
                 OR LOWER(email) = LOWER(${username})
            `;
            if (uRes.length > 0) credited = true;
          }
          if (!credited && phone9) {
            await db`
              UPDATE malicrush_users 
              SET balance = balance + ${amountKes}, updated_at = CURRENT_TIMESTAMP
              WHERE phone LIKE ${'%' + phone9}
            `;
          }
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

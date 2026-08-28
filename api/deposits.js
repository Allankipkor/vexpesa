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
  const rawRef = (req.query.reference || req.query.ref || req.query.checkoutRequestId || (req.body ? req.body.reference : '') || '').trim();
  const ref = rawRef.length > 0 ? rawRef : null;
  const rawQueryPhone = (req.query.phone || (req.body ? req.body.phone : '') || '').trim();
  const queryPhone = rawQueryPhone.length > 0 ? rawQueryPhone : null;
  const rawQueryUser = (req.query.username || (req.body ? req.body.username : '') || '').trim();
  const queryUser = rawQueryUser.length > 0 ? rawQueryUser : null;

  // 1. SINGLE DEPOSIT STATUS CHECK (Client Polling & Active Verification)
  if (action === 'check') {
    if (db) {
      try {
        let rows = [];
        if (ref) {
          rows = await db`
            SELECT * FROM zentrapesa_deposits 
            WHERE deposit_ref = ${ref} 
               OR (checkout_request_id = ${ref} AND checkout_request_id != '')
               OR (id::text = ${ref}) 
            LIMIT 1
          `;
        }

        // Fallback search strictly for recent deposits by phone or username
        if (rows.length === 0 && queryPhone) {
          const phone9 = queryPhone.replace(/\D/g, '').slice(-9);
          if (phone9.length >= 8) {
            rows = await db`
              SELECT * FROM zentrapesa_deposits 
              WHERE phone LIKE ${'%' + phone9}
                AND created_at >= NOW() - INTERVAL '30 minutes'
              ORDER BY created_at DESC 
              LIMIT 1
            `;
          }
        }

        if (rows.length === 0 && queryUser && queryUser !== 'Trader') {
          rows = await db`
            SELECT * FROM zentrapesa_deposits 
            WHERE (LOWER(username) = LOWER(${queryUser}))
              AND created_at >= NOW() - INTERVAL '30 minutes'
            ORDER BY created_at DESC 
            LIMIT 1
          `;
        }

        if (rows.length > 0) {
          const d = rows[0];

          // If older than 10 minutes and still pending, mark as timed out/failed
          if (d.status === 'pending' && d.created_at) {
            const ageMs = Date.now() - new Date(d.created_at).getTime();
            if (ageMs > 10 * 60 * 1000) {
              d.status = 'failed';
              await db`UPDATE zentrapesa_deposits SET status = 'failed' WHERE id = ${d.id}`;
            }
          }

          let isCompleted = d.status === 'completed' || d.status === 'success' || d.status === 'successful';

          // ACTIVE LIVE RECONCILIATION: If still pending, query GravityPay STK Status API in real-time
          if (!isCompleted && d.status === 'pending') {
            try {
              let gpKey = process.env.GRAVITYPAY_API_KEY || '';
              let gpSec = process.env.GRAVITYPAY_SECRET_KEY || '';

              const cfgRows = await db`SELECT value FROM zentrapesa_settings WHERE key = 'platform_config' LIMIT 1`;
              if (cfgRows.length > 0) {
                const saved = JSON.parse(cfgRows[0].value);
                if (!gpKey) gpKey = (saved.gravitypayApiKey || saved.payments?.gravitypay?.api_key || '').trim();
                if (!gpSec) gpSec = (saved.gravitypaySecretKey || saved.payments?.gravitypay?.secret_key || '').trim();
              }

              if (gpKey || gpSec) {
                const headers = { 'Content-Type': 'application/json' };
                if (gpSec) headers['Authorization'] = `Bearer ${gpSec}`;
                if (gpKey) headers['x-api-key'] = gpKey;
                if (!gpSec && gpKey) headers['Authorization'] = `Bearer ${gpKey}`;
                if (!gpKey && gpSec) headers['x-api-key'] = gpSec;

                let gpStatusData = null;
                if (d.checkout_request_id && d.checkout_request_id.length > 3) {
                  try {
                    const r = await fetch(`https://api.gravitypayapp.com/api/v1/stk/status/${encodeURIComponent(d.checkout_request_id)}`, { headers });
                    if (r.ok) gpStatusData = await r.json();
                  } catch(e) {}
                }

                if (!gpStatusData && d.deposit_ref) {
                  try {
                    const r = await fetch(`https://api.gravitypayapp.com/api/v1/transactions/${encodeURIComponent(d.deposit_ref)}`, { headers });
                    if (r.ok) gpStatusData = await r.json();
                  } catch(e) {}
                }

                if (gpStatusData) {
                  const dataObj = gpStatusData.data || gpStatusData.response || gpStatusData;
                  const gStatus = (dataObj.status || gpStatusData.status || '').toString().toLowerCase();
                  const gReceipt = (dataObj.mpesaReceipt || dataObj.receipt || dataObj.mpesa_reference || dataObj.MpesaReceiptNumber || '').toString().toUpperCase().trim();

                  if (gStatus === 'completed' || gStatus === 'success' || gStatus === 'successful' || gStatus === 'paid' || Boolean(gReceipt)) {
                    const finalMethod = gReceipt.length >= 4 ? `M-Pesa (${gReceipt})` : 'M-Pesa (GravityPay)';
                    await db`
                      UPDATE zentrapesa_deposits 
                      SET status = 'completed', method = ${finalMethod} 
                      WHERE id = ${d.id}
                    `;
                    d.status = 'completed';
                    d.method = finalMethod;
                    isCompleted = true;
                  } else if (gStatus === 'failed' || gStatus === 'cancelled' || gStatus === 'declined') {
                    await db`UPDATE zentrapesa_deposits SET status = 'failed' WHERE id = ${d.id}`;
                    d.status = 'failed';
                  }
                }
              }
            } catch(reconcileErr) {
              console.error('GravityPay active status query error:', reconcileErr);
            }
          }

          let currentBal = null;

          // If completed and not marked credited yet, credit user atomically right now
          if (isCompleted && parseFloat(d.amount_kes) > 0 && !d.credited) {
            const uName = (d.username && d.username !== 'Trader') ? d.username : queryUser;
            const uPhone = (d.phone || queryPhone || '').replace(/\D/g, '').slice(-9);
            const amt = parseFloat(d.amount_kes);

            let credited = false;
            let creditedUser = uName;

            if (uName && uName !== 'Trader') {
              const uRes = await db`
                UPDATE zentrapesa_users 
                SET balance = balance + ${amt}, updated_at = CURRENT_TIMESTAMP
                WHERE LOWER(username) = LOWER(${uName}) 
                   OR LOWER(name) = LOWER(${uName}) 
                   OR LOWER(email) = LOWER(${uName})
                RETURNING id, username, balance
              `;
              if (uRes.length > 0) {
                credited = true;
                creditedUser = uRes[0].username;
                currentBal = parseFloat(uRes[0].balance || 0);
              }
            }

            if (!credited && uPhone.length >= 8) {
              const uRes = await db`
                UPDATE zentrapesa_users 
                SET balance = balance + ${amt}, updated_at = CURRENT_TIMESTAMP
                WHERE phone LIKE ${'%' + uPhone}
                RETURNING id, username, balance
              `;
              if (uRes.length > 0) {
                credited = true;
                creditedUser = uRes[0].username;
                currentBal = parseFloat(uRes[0].balance || 0);
              }
            }

            if (credited) {
              await db`
                UPDATE zentrapesa_deposits 
                SET credited = TRUE, 
                    username = COALESCE(NULLIF(${creditedUser || ''}, ''), username) 
                WHERE id = ${d.id}
              `;
            }

            // Create M-Pesa receipt message and auto-prune to latest 20
            try {
              await db`
                INSERT INTO zentrapesa_messages (user_id, username, title, body, read)
                VALUES (
                  ${creditedUser || uName || d.phone || 'Trader'},
                  ${creditedUser || uName || 'Trader'},
                  'MPESA',
                  ${`Payment Confirmed. Ksh${amt.toFixed(2)} received on ${new Date().toLocaleDateString('en-GB')}. Thank you for using ZentraPesa.`},
                  FALSE
                )
              `;

              // Auto-prune older messages beyond 20 for this user
              await db`
                DELETE FROM zentrapesa_messages
                WHERE id IN (
                  SELECT id FROM zentrapesa_messages
                  WHERE LOWER(username) = LOWER(${creditedUser || uName || 'Trader'}) OR LOWER(user_id) = LOWER(${creditedUser || uName || d.phone || 'Trader'})
                  ORDER BY created_at DESC
                  OFFSET 20
                )
              `;
            } catch(mErr) {}
          }

          // If already credited, get latest user balance
          if (isCompleted && currentBal === null) {
            try {
              const uName = d.username;
              const uPhone = (d.phone || queryPhone || '').replace(/\D/g, '').slice(-9);
              let uRes = [];
              if (uName && uName !== 'Trader') {
                uRes = await db`SELECT balance FROM zentrapesa_users WHERE LOWER(username) = LOWER(${uName}) OR LOWER(email) = LOWER(${uName}) LIMIT 1`;
              }
              if (uRes.length === 0 && uPhone.length >= 8) {
                uRes = await db`SELECT balance FROM zentrapesa_users WHERE phone LIKE ${'%' + uPhone} LIMIT 1`;
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

  // 2. ADMIN RECONCILIATION ACTION (Cleans up phantom duplicate receipt rows)
  if (action === 'reconcile' && db) {
    try {
      // Reconcile duplicate M-Pesa receipts: keep only earliest 1 per receipt, mark remainder as superseded
      const dupes = await db`
        WITH duplicates AS (
          SELECT id, 
                 ROW_NUMBER() OVER (
                   PARTITION BY method 
                   ORDER BY created_at ASC, id ASC
                 ) AS rn
          FROM zentrapesa_deposits
          WHERE (status = 'completed' OR status = 'success' OR status = 'successful')
            AND method LIKE 'M-Pesa (%'
            AND method NOT LIKE 'M-Pesa (GravityPay)'
            AND method NOT LIKE 'M-Pesa (PayHero)'
            AND method NOT LIKE 'M-Pesa STK'
        )
        UPDATE zentrapesa_deposits
        SET status = 'superseded'
        WHERE id IN (SELECT id FROM duplicates WHERE rn > 1)
        RETURNING id, deposit_ref, method
      `;
      return res.status(200).json({
        success: true,
        reconciled_count: dupes.length,
        message: `Successfully reconciled ${dupes.length} duplicate deposit records.`
      });
    } catch(recErr) {
      console.error('Error reconciling deposits:', recErr);
      return res.status(500).json({ success: false, error: recErr.message });
    }
  }

  // 3. GET ALL DEPOSITS & STATS (Strictly Successful Deposits for Admin Ledger)
  if (req.method === 'GET') {
    if (db) {
      try {
        // Auto-reconcile duplicate M-Pesa receipts on fetch
        try {
          await db`
            WITH duplicates AS (
              SELECT id, 
                     ROW_NUMBER() OVER (
                       PARTITION BY method 
                       ORDER BY created_at ASC, id ASC
                     ) AS rn
              FROM zentrapesa_deposits
              WHERE (status = 'completed' OR status = 'success' OR status = 'successful')
                AND method LIKE 'M-Pesa (%'
                AND method NOT LIKE 'M-Pesa (GravityPay)'
                AND method NOT LIKE 'M-Pesa (PayHero)'
                AND method NOT LIKE 'M-Pesa STK'
            )
            UPDATE zentrapesa_deposits
            SET status = 'superseded'
            WHERE id IN (SELECT id FROM duplicates WHERE rn > 1)
          `;
        } catch(autoRecErr) {}

        const onlySuccess = req.query.all !== 'true';
        let deposits;
        if (onlySuccess) {
          deposits = await db`
            SELECT id, deposit_ref, checkout_request_id, username, amount_kes, amount_usd, currency, method, phone, status, credited, created_at
            FROM zentrapesa_deposits
            WHERE status = 'completed' OR status = 'success' OR status = 'successful'
            ORDER BY created_at DESC
            LIMIT 100
          `;
        } else {
          deposits = await db`
            SELECT id, deposit_ref, checkout_request_id, username, amount_kes, amount_usd, currency, method, phone, status, credited, created_at
            FROM zentrapesa_deposits
            ORDER BY created_at DESC
            LIMIT 100
          `;
        }

        let totalKes = 0;
        let totalCount = deposits.length;
        try {
          const sumRes = await db`
            SELECT COALESCE(SUM(amount_kes), 0) AS total_kes, COUNT(*) AS cnt 
            FROM zentrapesa_deposits 
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

  // 4. CREATE OR CONFIRM DEPOSIT
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
          INSERT INTO zentrapesa_deposits (deposit_ref, checkout_request_id, username, amount_kes, amount_usd, currency, method, phone, status, credited)
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
              UPDATE zentrapesa_users 
              SET balance = balance + ${amountKes}, updated_at = CURRENT_TIMESTAMP
              WHERE LOWER(username) = LOWER(${username}) 
                 OR LOWER(name) = LOWER(${username}) 
                 OR LOWER(email) = LOWER(${username})
            `;
            if (uRes.length > 0) credited = true;
          }
          if (!credited && phone9.length >= 8) {
            await db`
              UPDATE zentrapesa_users 
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


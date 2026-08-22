import { getDb, initDb } from './db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Signature, X-Webhook-Timestamp, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  await initDb();
  const db = getDb();

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) { body = {}; }
  } else if (!body) {
    body = {};
  }

  const response = body.response || body.data || body;

  // Extract fields from PayHero v1/v2 AND GravityPay (gravitypayapp.com) webhooks
  const status = (response.status || response.Status || body.status || body.Status || '').toString().toLowerCase();
  const externalRef = (
    response.reference || body.reference || 
    response.ExternalReference || body.external_reference || response.external_reference || response.externalReference ||
    response.checkoutRequestId || body.checkoutRequestId || 
    response.transactionId || body.transactionId || 
    ''
  ).trim();
  const mpesaReceipt = (response.mpesaReceipt || body.mpesaReceipt || response.MpesaReceiptNumber || response.mpesa_reference || response.receipt || response.MpesaReceipt || '').trim();
  const amount = parseFloat(response.amount || body.amount || response.Amount || body.Amount) || 0;
  const phone = (response.phoneNumber || body.phoneNumber || response.Phone || body.Phone || response.phone || body.phone || response.phone_number || '').trim();
  const metadataUser = (response.metadata?.username || body.metadata?.username || response.customer_name || '').trim();
  const resultCode = response.ResultCode !== undefined ? parseInt(response.ResultCode) : (body.ResultCode !== undefined ? parseInt(body.ResultCode) : null);

  const isSuccess = (status === 'success' || status === 'successful' || status === 'completed') || resultCode === 0 || mpesaReceipt.length > 0;

  if (db) {
    try {
      if (isSuccess && amount > 0) {
        // 1. Update deposit record in malicrush_deposits
        let updatedDep = [];
        if (externalRef) {
          updatedDep = await db`
            UPDATE malicrush_deposits
            SET status = 'completed',
                method = ${mpesaReceipt ? `M-Pesa (${mpesaReceipt})` : 'M-Pesa STK'},
                amount_kes = ${amount}
            WHERE deposit_ref = ${externalRef}
            RETURNING *
          `;
        }

        // Fallback 1: If ref was not found but phone is present, update most recent pending deposit for this phone
        if (updatedDep.length === 0 && phone) {
          const phone9 = phone.replace(/\D/g, '').slice(-9);
          if (phone9) {
            updatedDep = await db`
              UPDATE malicrush_deposits
              SET status = 'completed',
                  method = ${mpesaReceipt ? `M-Pesa (${mpesaReceipt})` : 'M-Pesa STK'},
                  amount_kes = ${amount}
              WHERE id = (
                SELECT id FROM malicrush_deposits 
                WHERE (phone LIKE ${'%' + phone9} OR deposit_ref = ${externalRef}) 
                  AND status = 'pending'
                ORDER BY created_at DESC 
                LIMIT 1
              )
              RETURNING *
            `;
          }
        }

        // Fallback 2: If metadata username is present, update most recent pending deposit for that username
        if (updatedDep.length === 0 && metadataUser && metadataUser !== 'Trader') {
          updatedDep = await db`
            UPDATE malicrush_deposits
            SET status = 'completed',
                method = ${mpesaReceipt ? `M-Pesa (${mpesaReceipt})` : 'M-Pesa STK'},
                amount_kes = ${amount}
            WHERE id = (
              SELECT id FROM malicrush_deposits 
              WHERE LOWER(username) = LOWER(${metadataUser}) AND status = 'pending'
              ORDER BY created_at DESC 
              LIMIT 1
            )
            RETURNING *
          `;
        }

        // If no prior deposit record existed, create one
        let depRecord = updatedDep[0];
        if (!depRecord && (externalRef || phone)) {
          const inserted = await db`
            INSERT INTO malicrush_deposits (deposit_ref, username, amount_kes, phone, method, status, credited)
            VALUES (${externalRef || 'DEP-' + Date.now()}, ${metadataUser || 'Trader'}, ${amount}, ${phone}, ${mpesaReceipt ? `M-Pesa (${mpesaReceipt})` : 'M-Pesa STK'}, 'completed', FALSE)
            ON CONFLICT (deposit_ref) DO UPDATE 
            SET status = 'completed', amount_kes = ${amount}
            RETURNING *
          `;
          depRecord = inserted[0];
        }

        // 2. Credit user's wallet in malicrush_users table if not already credited
        if (depRecord && !depRecord.credited) {
          const targetUser = (depRecord.username && depRecord.username !== 'Trader') ? depRecord.username : metadataUser;
          const targetPhone = depRecord.phone || phone;
          const phone9 = (targetPhone || '').replace(/\D/g, '').slice(-9);

          let userCredited = false;
          if (targetUser && targetUser !== 'Trader') {
            const userUpdate = await db`
              UPDATE malicrush_users
              SET balance = balance + ${amount}, updated_at = CURRENT_TIMESTAMP
              WHERE LOWER(username) = LOWER(${targetUser}) 
                 OR LOWER(name) = LOWER(${targetUser}) 
                 OR LOWER(email) = LOWER(${targetUser})
              RETURNING id, username, balance
            `;
            if (userUpdate.length > 0) userCredited = true;
          }

          if (!userCredited && phone9) {
            await db`
              UPDATE malicrush_users
              SET balance = balance + ${amount}, updated_at = CURRENT_TIMESTAMP
              WHERE phone LIKE ${'%' + phone9}
            `;
          }

          // Mark deposit as credited in malicrush_deposits
          await db`
            UPDATE malicrush_deposits
            SET credited = TRUE
            WHERE id = ${depRecord.id}
          `;

          // 3. Create M-Pesa receipt message in trader inbox
          try {
            const mpesaCode = mpesaReceipt || ('NLJ' + Date.now().toString().slice(-7));
            await db`
              INSERT INTO malicrush_messages (user_id, username, title, body, read)
              VALUES (
                ${targetUser || phone || 'Trader'},
                ${targetUser || 'Trader'},
                'MPESA',
                ${`${mpesaCode} Confirmed. Ksh${amount.toFixed(2)} received on ${new Date().toLocaleDateString('en-GB')}. Thank you for using MaliCrush.`},
                FALSE
              )
            `;
          } catch(msgErr) {}
        }

      } else if (externalRef) {
        // Mark deposit as failed
        await db`
          UPDATE malicrush_deposits
          SET status = 'failed'
          WHERE deposit_ref = ${externalRef} AND status = 'pending'
        `;
      }
    } catch(err) {
      console.error('Error processing Payment Gateway callback:', err);
    }
  }

  return res.status(200).json({
    status: 'OK',
    message: isSuccess ? 'Payment confirmed and credited successfully' : 'Payment recorded'
  });
}

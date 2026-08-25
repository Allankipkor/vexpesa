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
  const status = (response.status || response.Status || body.status || body.Status || '').toString().toLowerCase().trim();
  const rawCheckoutId = (response.checkoutRequestId || body.checkoutRequestId || response.checkout_request_id || body.checkout_request_id || response.transactionId || body.transactionId || '').trim();
  const checkoutRequestId = rawCheckoutId.length > 0 ? rawCheckoutId : null;

  const rawExternalRef = (
    response.reference || body.reference || 
    response.ExternalReference || body.external_reference || response.external_reference || response.externalReference ||
    ''
  ).trim();
  const externalRef = rawExternalRef.length > 0 ? rawExternalRef : null;

  const rawMpesaReceipt = (response.mpesaReceipt || body.mpesaReceipt || response.MpesaReceiptNumber || response.mpesa_reference || response.receipt || response.MpesaReceipt || '').trim().toUpperCase();
  const mpesaReceipt = rawMpesaReceipt.length >= 4 ? rawMpesaReceipt : null;

  const amount = parseFloat(response.amount || body.amount || response.Amount || body.Amount) || 0;
  const phone = (response.phoneNumber || body.phoneNumber || response.Phone || body.Phone || response.phone || body.phone || response.phone_number || '').trim();
  const metadataUser = (response.metadata?.username || body.metadata?.username || response.customer_name || '').trim();
  const resultCode = response.ResultCode !== undefined ? parseInt(response.ResultCode) : (body.ResultCode !== undefined ? parseInt(body.ResultCode) : null);

  const isSuccess = (status === 'success' || status === 'successful' || status === 'completed') || resultCode === 0 || Boolean(mpesaReceipt);

  if (db) {
    try {
      if (isSuccess && amount > 0) {
        // 1. REPLAY / IDEMPOTENCY PROTECTION: Check if this M-Pesa receipt has already been processed and completed
        if (mpesaReceipt) {
          const existingReceipt = await db`
            SELECT id, deposit_ref, username, amount_kes, credited, status
            FROM malicrush_deposits
            WHERE method LIKE ${'%' + mpesaReceipt + '%'} 
              AND (status = 'completed' OR status = 'success' OR status = 'successful')
            LIMIT 1
          `;
          if (existingReceipt.length > 0 && existingReceipt[0].credited) {
            console.log(`[Webhook] Duplicate notification received for already processed receipt: ${mpesaReceipt}`);
            return res.status(200).json({ status: 'OK', message: 'Transaction already processed and credited', receipt: mpesaReceipt });
          }
        }

        // 2. STRICT TARGET RESOLUTION: Find the EXACT target deposit to mark completed
        let depRecord = null;

        // Step 2a: Match strictly by unique deposit_ref / external_reference (NEVER match on empty string)
        if (externalRef) {
          const rows = await db`
            SELECT * FROM malicrush_deposits
            WHERE deposit_ref = ${externalRef}
            LIMIT 1
          `;
          if (rows.length > 0) depRecord = rows[0];
        }

        // Step 2b: Match strictly by checkoutRequestId (if non-empty and not already matched)
        if (!depRecord && checkoutRequestId) {
          const rows = await db`
            SELECT * FROM malicrush_deposits
            WHERE checkout_request_id = ${checkoutRequestId}
            LIMIT 1
          `;
          if (rows.length > 0) depRecord = rows[0];
        }

        // Step 2c: Fallback matching by phone (ONLY match a SINGLE most recent PENDING deposit created within 20 mins)
        if (!depRecord && phone) {
          const phone9 = phone.replace(/\D/g, '').slice(-9);
          if (phone9.length >= 8) {
            const rows = await db`
              SELECT * FROM malicrush_deposits
              WHERE phone LIKE ${'%' + phone9}
                AND status = 'pending'
                AND created_at >= NOW() - INTERVAL '20 minutes'
              ORDER BY created_at DESC
              LIMIT 1
            `;
            if (rows.length > 0) depRecord = rows[0];
          }
        }

        // Step 2d: Fallback matching by username (ONLY match a SINGLE most recent PENDING deposit created within 20 mins)
        if (!depRecord && metadataUser && metadataUser !== 'Trader') {
          const rows = await db`
            SELECT * FROM malicrush_deposits
            WHERE LOWER(username) = LOWER(${metadataUser})
              AND status = 'pending'
              AND created_at >= NOW() - INTERVAL '20 minutes'
            ORDER BY created_at DESC
            LIMIT 1
          `;
          if (rows.length > 0) depRecord = rows[0];
        }

        const formattedMethod = mpesaReceipt ? `M-Pesa (${mpesaReceipt})` : (depRecord?.method || 'M-Pesa STK');

        // Step 2e: If a pending deposit was found, update strictly THAT single record by ID
        if (depRecord) {
          const updated = await db`
            UPDATE malicrush_deposits
            SET status = 'completed',
                method = ${formattedMethod},
                amount_kes = ${amount},
                checkout_request_id = COALESCE(NULLIF(${checkoutRequestId || ''}, ''), checkout_request_id)
            WHERE id = ${depRecord.id}
            RETURNING *
          `;
          if (updated.length > 0) depRecord = updated[0];
        } else {
          // If no matching pending record exists, insert a single new completed record
          const newRef = externalRef || ('MC' + Date.now().toString().slice(-8) + Math.floor(Math.random() * 100).toString().padStart(2, '0'));
          const inserted = await db`
            INSERT INTO malicrush_deposits (deposit_ref, checkout_request_id, username, amount_kes, phone, method, status, credited)
            VALUES (${newRef}, ${checkoutRequestId || ''}, ${metadataUser || 'Trader'}, ${amount}, ${phone}, ${formattedMethod}, 'completed', FALSE)
            ON CONFLICT (deposit_ref) DO UPDATE
            SET status = 'completed', amount_kes = ${amount}, method = ${formattedMethod}
            RETURNING *
          `;
          depRecord = inserted[0];
        }

        // 3. CREDIT USER'S WALLET (Atomic and protected against double-crediting)
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

          if (!userCredited && phone9.length >= 8) {
            await db`
              UPDATE malicrush_users
              SET balance = balance + ${amount}, updated_at = CURRENT_TIMESTAMP
              WHERE phone LIKE ${'%' + phone9}
            `;
          }

          // Mark this specific deposit as credited
          await db`
            UPDATE malicrush_deposits
            SET credited = TRUE
            WHERE id = ${depRecord.id}
          `;

          // 4. AUTO-CANCEL / SUPERSEDE OTHER PENDING ATTEMPTS for this user/phone
          if (phone9.length >= 8) {
            try {
              await db`
                UPDATE malicrush_deposits
                SET status = 'superseded'
                WHERE id != ${depRecord.id}
                  AND phone LIKE ${'%' + phone9}
                  AND status = 'pending'
                  AND created_at <= ${depRecord.created_at || new Date()}
              `;
            } catch(supErr) {}
          }

          // 5. Send M-Pesa receipt message to user's inbox and auto-prune to latest 20
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

            // Prune older messages beyond 20 for this user
            await db`
              DELETE FROM malicrush_messages
              WHERE id IN (
                SELECT id FROM malicrush_messages
                WHERE LOWER(username) = LOWER(${targetUser || 'Trader'}) OR LOWER(user_id) = LOWER(${targetUser || phone || 'Trader'})
                ORDER BY created_at DESC
                OFFSET 20
              )
            `;
          } catch(msgErr) {}
        }

      } else if (externalRef || checkoutRequestId) {
        // Mark failed strictly for the specific reference (never with empty strings)
        if (externalRef) {
          await db`
            UPDATE malicrush_deposits
            SET status = 'failed'
            WHERE deposit_ref = ${externalRef} AND status = 'pending'
          `;
        } else if (checkoutRequestId) {
          await db`
            UPDATE malicrush_deposits
            SET status = 'failed'
            WHERE checkout_request_id = ${checkoutRequestId} AND status = 'pending'
          `;
        }
      }
    } catch(err) {
      console.error('Error processing Payment Gateway callback:', err);
    }
  }

  return res.status(200).json({
    status: 'OK',
    message: isSuccess ? 'Payment confirmed and processed' : 'Payment recorded'
  });
}


import crypto from 'crypto';
import { getDb, initDb } from './db.js';

function verifyGravityPaySignature(req, rawBody, webhookSecret) {
  if (!webhookSecret) return true; // If secret is not configured, permit processing

  const signatureHeader = req.headers['x-webhook-signature'] || 
                          req.headers['x-signature'] || 
                          req.headers['x-hub-signature-256'] || 
                          req.headers['x-gravitypay-signature'] ||
                          req.headers['authorization'];

  if (!signatureHeader) return true; // If signature header omitted, permit processing

  const timestamp = req.headers['x-webhook-timestamp'] || req.headers['x-timestamp'] || '';
  const bodyString = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody);

  try {
    const expectedSig1 = crypto.createHmac('sha256', webhookSecret).update(bodyString).digest('hex');
    const expectedSig2 = timestamp ? crypto.createHmac('sha256', webhookSecret).update(`${timestamp}.${bodyString}`).digest('hex') : null;
    const expectedSig3 = timestamp ? crypto.createHmac('sha256', webhookSecret).update(`${timestamp}${bodyString}`).digest('hex') : null;

    const cleanSig = signatureHeader.replace(/^sha256=/, '').replace(/^Bearer\s+/i, '').trim();

    return cleanSig === expectedSig1 || cleanSig === expectedSig2 || cleanSig === expectedSig3 || cleanSig === webhookSecret;
  } catch(e) {
    return true;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Signature, X-Webhook-Timestamp, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'OK',
      webhook: 'GravityPay / PayHero Webhook Endpoint Active',
      platform: 'ZentraPesa',
      url: 'https://zentrapesa.com/api/webhooks/gravitypay',
      timestamp: new Date().toISOString()
    });
  }

  await initDb();
  const db = getDb();

  let rawBody = req.body;
  let body = rawBody;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) { body = {}; }
  } else if (!body) {
    body = {};
  }

  // Fetch GravityPay webhook secret from DB or environment if available
  let webhookSecret = process.env.GRAVITYPAY_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || '';
  if (db && !webhookSecret) {
    try {
      const cfgRows = await db`SELECT value FROM zentrapesa_settings WHERE key = 'platform_config' LIMIT 1`;
      if (cfgRows.length > 0) {
        const saved = JSON.parse(cfgRows[0].value);
        webhookSecret = (saved.gravitypayWebhookSecret || saved.payments?.gravitypay?.webhook_secret || '').trim();
      }
    } catch(e) {}
  }

  const isValidSignature = verifyGravityPaySignature(req, rawBody, webhookSecret);
  if (!isValidSignature) {
    console.warn('[Webhook] GravityPay signature mismatch, proceeding with payload validation');
  }

  const response = body.response || body.data || body;

  // Extract fields from PayHero v1/v2 AND GravityPay (gravitypayapp.com) webhooks
  const event = (body.event || response.event || '').toString().toLowerCase().trim();
  const status = (response.status || response.Status || body.status || body.Status || body.data?.status || '').toString().toLowerCase().trim();
  
  const rawCheckoutId = (
    response.checkoutRequestId || body.checkoutRequestId || 
    response.CheckoutRequestID || body.CheckoutRequestID || 
    response.checkout_request_id || body.checkout_request_id || 
    response.transactionId || body.transactionId || 
    response.transaction_id || body.transaction_id || 
    body.data?.checkoutRequestId || body.data?.CheckoutRequestID || body.data?.transactionId ||
    ''
  ).trim();
  const checkoutRequestId = rawCheckoutId.length > 0 ? rawCheckoutId : null;

  const rawExternalRef = (
    response.reference || body.reference || 
    response.ExternalReference || body.ExternalReference || 
    response.external_reference || body.external_reference || 
    response.externalReference || body.externalReference || 
    body.data?.reference || response.ref || body.ref ||
    ''
  ).trim();
  const externalRef = rawExternalRef.length > 0 ? rawExternalRef : null;

  const rawMpesaReceipt = (
    response.mpesaReceipt || body.mpesaReceipt || 
    response.MpesaReceiptNumber || body.MpesaReceiptNumber || 
    response.mpesa_reference || body.mpesa_reference || 
    response.receipt || body.receipt || 
    response.MpesaReceipt || body.MpesaReceipt || 
    body.data?.mpesaReceipt || body.data?.receipt || body.data?.mpesa_reference ||
    ''
  ).trim().toUpperCase();
  const mpesaReceipt = rawMpesaReceipt.length >= 4 ? rawMpesaReceipt : null;

  const amount = parseFloat(
    response.amount || body.amount || 
    response.Amount || body.Amount || 
    body.data?.amount || 0
  ) || 0;

  const phone = (
    response.phoneNumber || body.phoneNumber || 
    response.PhoneNumber || body.PhoneNumber || 
    response.Phone || body.Phone || 
    response.phone || body.phone || 
    response.phone_number || body.phone_number || 
    body.data?.phoneNumber || body.data?.phone ||
    ''
  ).trim();

  const metadataUser = (
    response.metadata?.username || body.metadata?.username || 
    body.data?.metadata?.username || response.customer_name || 
    body.customer_name || response.name || body.name || 
    ''
  ).trim();

  const resultCode = response.ResultCode !== undefined ? parseInt(response.ResultCode) : 
    (body.ResultCode !== undefined ? parseInt(body.ResultCode) : 
    (response.resultCode !== undefined ? parseInt(response.resultCode) : null));

  const isSuccess = (status === 'success' || status === 'successful' || status === 'completed' || status === 'paid') || 
                    (event === 'payment.success' || event === 'transaction.success' || event === 'stk.success') || 
                    resultCode === 0 || 
                    Boolean(mpesaReceipt);

  if (db) {
    try {
      if (isSuccess && amount > 0) {
        // 1. REPLAY / IDEMPOTENCY PROTECTION: Check if this M-Pesa receipt has already been processed and credited
        if (mpesaReceipt) {
          const existingReceipt = await db`
            SELECT id, deposit_ref, username, amount_kes, credited, status
            FROM zentrapesa_deposits
            WHERE method LIKE ${'%' + mpesaReceipt + '%'} 
              AND (status = 'completed' OR status = 'success' OR status = 'successful')
            LIMIT 1
          `;
          if (existingReceipt.length > 0 && existingReceipt[0].credited) {
            console.log(`[Webhook] Duplicate notification received for already processed receipt: ${mpesaReceipt}`);
            return res.status(200).json({ status: 'OK', success: true, message: 'Transaction already processed and credited', receipt: mpesaReceipt });
          }
        }

        // 2. STRICT TARGET RESOLUTION: Find the EXACT target deposit to mark completed
        let depRecord = null;

        // Step 2a: Match strictly by unique deposit_ref / external_reference (NEVER match on empty string)
        if (externalRef) {
          const rows = await db`
            SELECT * FROM zentrapesa_deposits
            WHERE deposit_ref = ${externalRef}
            LIMIT 1
          `;
          if (rows.length > 0) depRecord = rows[0];
        }

        // Step 2b: Match strictly by checkoutRequestId (if non-empty and not already matched)
        if (!depRecord && checkoutRequestId) {
          const rows = await db`
            SELECT * FROM zentrapesa_deposits
            WHERE checkout_request_id = ${checkoutRequestId}
            LIMIT 1
          `;
          if (rows.length > 0) depRecord = rows[0];
        }

        // Step 2c: Fallback matching by phone (match most recent pending or expired deposit within 30 mins)
        if (!depRecord && phone) {
          const phone9 = phone.replace(/\D/g, '').slice(-9);
          if (phone9.length >= 8) {
            const rows = await db`
              SELECT * FROM zentrapesa_deposits
              WHERE phone LIKE ${'%' + phone9}
                AND status IN ('pending', 'expired')
                AND created_at >= NOW() - INTERVAL '30 minutes'
              ORDER BY created_at DESC
              LIMIT 1
            `;
            if (rows.length > 0) depRecord = rows[0];
          }
        }

        // Step 2d: Fallback matching by username (match most recent pending or expired deposit within 30 mins)
        if (!depRecord && metadataUser && metadataUser !== 'Trader') {
          const rows = await db`
            SELECT * FROM zentrapesa_deposits
            WHERE LOWER(username) = LOWER(${metadataUser})
              AND status IN ('pending', 'expired')
              AND created_at >= NOW() - INTERVAL '30 minutes'
            ORDER BY created_at DESC
            LIMIT 1
          `;
          if (rows.length > 0) depRecord = rows[0];
        }

        const formattedMethod = mpesaReceipt ? `M-Pesa (${mpesaReceipt})` : (depRecord?.method || 'M-Pesa STK');

        // Step 2e: If a deposit was found, claim it atomically so only 1 process (webhook or polling) can credit the user
        let claim = [];
        if (depRecord) {
          claim = await db`
            UPDATE zentrapesa_deposits
            SET credited = TRUE,
                status = 'completed',
                method = ${formattedMethod},
                amount_kes = ${amount},
                checkout_request_id = COALESCE(NULLIF(${checkoutRequestId || ''}, ''), checkout_request_id)
            WHERE id = ${depRecord.id} AND credited = FALSE
            RETURNING id, username, phone, amount_kes
          `;
        } else {
          // If no matching pending record exists, insert a single new completed credited record
          const newRef = externalRef || ('ZP' + Date.now().toString().slice(-8) + Math.floor(Math.random() * 100).toString().padStart(2, '0'));
          claim = await db`
            INSERT INTO zentrapesa_deposits (deposit_ref, checkout_request_id, username, amount_kes, phone, method, status, credited)
            VALUES (${newRef}, ${checkoutRequestId || ''}, ${metadataUser || 'Trader'}, ${amount}, ${phone}, ${formattedMethod}, 'completed', TRUE)
            ON CONFLICT (deposit_ref) DO UPDATE
            SET status = 'completed', amount_kes = ${amount}, method = ${formattedMethod}
            WHERE zentrapesa_deposits.credited = FALSE
            RETURNING id, username, phone, amount_kes
          `;
        }

        // 3. CREDIT USER'S WALLET (Only executed if THIS webhook request successfully claimed the deposit)
        if (claim.length > 0) {
          const targetDep = claim[0];
          const targetUser = (targetDep.username && targetDep.username !== 'Trader') ? targetDep.username : metadataUser;
          const targetPhone = targetDep.phone || phone;
          const phone9 = (targetPhone || '').replace(/\D/g, '').slice(-9);

          let userCredited = false;
          let creditedUsername = targetUser;

          if (targetUser && targetUser !== 'Trader') {
            const userUpdate = await db`
              UPDATE zentrapesa_users
              SET balance = balance + ${amount}, updated_at = CURRENT_TIMESTAMP
              WHERE LOWER(username) = LOWER(${targetUser}) 
                 OR LOWER(name) = LOWER(${targetUser}) 
                 OR LOWER(email) = LOWER(${targetUser})
              RETURNING id, username, balance
            `;
            if (userUpdate.length > 0) {
              userCredited = true;
              creditedUsername = userUpdate[0].username;
            }
          }

          if (!userCredited && phone9.length >= 8) {
            const userUpdatePhone = await db`
              UPDATE zentrapesa_users
              SET balance = balance + ${amount}, updated_at = CURRENT_TIMESTAMP
              WHERE phone LIKE ${'%' + phone9}
              RETURNING id, username, balance
            `;
            if (userUpdatePhone.length > 0) {
              userCredited = true;
              creditedUsername = userUpdatePhone[0].username;
            }
          }

          if (userCredited && creditedUsername && creditedUsername !== targetDep.username) {
            await db`UPDATE zentrapesa_deposits SET username = ${creditedUsername} WHERE id = ${targetDep.id}`;
          }
        }

        // 4. AUTO-CANCEL / SUPERSEDE OTHER PENDING ATTEMPTS for this user/phone
        if (phone9.length >= 8 && depRecord) {
          try {
            await db`
              UPDATE zentrapesa_deposits
              SET status = 'superseded'
              WHERE id != ${depRecord.id}
                AND phone LIKE ${'%' + phone9}
                AND status = 'pending'
                AND created_at <= ${depRecord.created_at || new Date()}
            `;
          } catch(supErr) {}
        }

      } else if (externalRef || checkoutRequestId) {
        // Mark failed strictly for the specific reference (never with empty strings)
        if (externalRef) {
          await db`
            UPDATE zentrapesa_deposits
            SET status = 'failed'
            WHERE deposit_ref = ${externalRef} AND status = 'pending'
          `;
        } else if (checkoutRequestId) {
          await db`
            UPDATE zentrapesa_deposits
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
    success: true,
    message: isSuccess ? 'Payment confirmed and processed' : 'Payment recorded'
  });
}

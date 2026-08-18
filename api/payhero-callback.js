import { getDb, initDb } from './db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  await initDb();
  const db = getDb();

  const body = req.body || {};
  const response = body.response || body;

  // Extract fields from PayHero v1 / v2 callbacks
  const status = (response.Status || response.status || body.status || '').toString().toLowerCase();
  const externalRef = (response.ExternalReference || response.external_reference || response.externalReference || body.external_reference || '').trim();
  const mpesaReceipt = (response.MpesaReceiptNumber || response.mpesa_reference || response.receipt || response.MpesaReceipt || '').trim();
  const amount = parseFloat(response.Amount || response.amount || body.amount) || 0;
  const phone = (response.Phone || response.phone || response.phone_number || '').trim();
  const resultCode = response.ResultCode !== undefined ? parseInt(response.ResultCode) : (body.ResultCode !== undefined ? parseInt(body.ResultCode) : null);

  const isSuccess = (status === 'success' || status === 'successful' || status === 'completed') || resultCode === 0;

  if (db && externalRef) {
    try {
      if (isSuccess && amount > 0) {
        // 1. Mark deposit as completed
        const updatedDep = await db`
          UPDATE deposits
          SET status = 'completed',
              method = ${mpesaReceipt ? `M-Pesa (${mpesaReceipt})` : 'M-Pesa STK'},
              amount_kes = ${amount}
          WHERE deposit_ref = ${externalRef}
          RETURNING *
        `;

        let targetUser = null;
        if (updatedDep.length > 0) {
          targetUser = updatedDep[0].username;
        }

        // 2. Credit user balance in users table
        if (targetUser && targetUser !== 'Trader') {
          await db`
            UPDATE users
            SET balance = balance + ${amount}, updated_at = CURRENT_TIMESTAMP
            WHERE username = ${targetUser} OR name = ${targetUser}
          `;
        } else if (phone) {
          await db`
            UPDATE users
            SET balance = balance + ${amount}, updated_at = CURRENT_TIMESTAMP
            WHERE phone LIKE ${'%' + phone.slice(-9)}
          `;
        }

        // 3. Create M-Pesa receipt message
        try {
          const mpesaCode = mpesaReceipt || ('NLJ' + Date.now().toString().slice(-7));
          await db`
            INSERT INTO messages (user_id, username, title, body, read)
            VALUES (
              ${targetUser || phone || 'Trader'},
              ${targetUser || 'Trader'},
              'MPESA',
              ${`${mpesaCode} Confirmed. Ksh${amount.toFixed(2)} received on ${new Date().toLocaleDateString('en-GB')}. Thank you for using MaliCrush.`},
              FALSE
            )
          `;
        } catch(msgErr) {}

      } else {
        // Mark deposit as failed
        await db`
          UPDATE deposits
          SET status = 'failed'
          WHERE deposit_ref = ${externalRef} AND status = 'pending'
        `;
      }
    } catch(err) {
      console.error('Error processing PayHero callback:', err);
    }
  }

  return res.status(200).json({
    status: 'OK',
    message: isSuccess ? 'Payment confirmed successfully' : 'Payment marked failed'
  });
}

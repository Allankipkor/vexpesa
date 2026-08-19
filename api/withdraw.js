import { getDb, initDb } from './db.js';

function generateMpesaRef() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0 = Jan, 7 = Aug

  // Year code: 2024 = S, 2025 = T, 2026 = U, etc.
  const baseYear = 2024;
  const baseCode = 83; // ASCII 'S'
  const yearOffset = (year - baseYear) % 26;
  const yearLetter = String.fromCharCode(baseCode + yearOffset);

  // Month code: Jan = A, Feb = B, ..., Aug = H, Sep = I, etc.
  const monthLetter = String.fromCharCode(65 + month);

  // 8 random alphanumeric chars
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let rest = '';
  for (let i = 0; i < 8; i++) {
    rest += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return `${yearLetter}${monthLetter}${rest}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  await initDb();
  const db = getDb();

  if (req.method === 'GET') {
    const username = (req.query.username || req.query.identifier || '').trim();
    if (!username) {
      return res.status(400).json({ success: false, error: 'Username is required' });
    }

    if (db) {
      try {
        const users = await db`
          SELECT balance, demo_balance, phone FROM users 
          WHERE username = ${username} OR name = ${username} OR email = ${username.toLowerCase()} OR id::text = ${username}
          LIMIT 1
        `;
        if (users.length > 0) {
          return res.status(200).json({
            success: true,
            balance: parseFloat(users[0].balance || 0),
            phone: users[0].phone || '',
            minWithdrawal: 100
          });
        }
      } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    return res.status(200).json({
      success: true,
      balance: 0,
      minWithdrawal: 100
    });
  }

  if (req.method === 'POST') {
    const {
      username,
      amount,
      phone,
      method = 'mpesa',
      currency = 'kes',
      walletAddress,
      localTime,
      localDate
    } = req.body || {};

    const withdrawAmt = parseFloat(amount) || 0;
    if (!username) {
      return res.status(400).json({ success: false, error: 'User is required.' });
    }
    if (withdrawAmt <= 0) {
      return res.status(400).json({ success: false, error: 'Please enter a valid withdrawal amount.' });
    }

    // Fetch dynamically configured min withdrawal from settings table
    let minRequired = 100.0;
    if (db) {
      try {
        const rows = await db`SELECT value FROM settings WHERE key = 'platform_config' LIMIT 1`;
        if (rows.length > 0) {
          const cfg = JSON.parse(rows[0].value);
          const configuredMin = cfg.minWithdraw !== undefined ? parseFloat(cfg.minWithdraw) : (cfg.withdraw?.min_withdrawal !== undefined ? parseFloat(cfg.withdraw.min_withdrawal) : null);
          if (configuredMin !== null && !isNaN(configuredMin) && configuredMin > 0) {
            minRequired = configuredMin;
          }
        }
      } catch(e) {}
    }

    if (withdrawAmt < minRequired) {
      return res.status(400).json({
        success: false,
        error: `Minimum withdrawal is KES ${minRequired.toLocaleString('en-US', {minimumFractionDigits: 0})}.`
      });
    }

    let updatedBalance = 0;
    let targetPhone = (phone || '').trim();
    let targetUserId = '';

    if (db) {
      try {
        const users = await db`
          SELECT id, username, email, phone, balance FROM users 
          WHERE username = ${username} OR name = ${username} OR email = ${username.toLowerCase()} OR id::text = ${username}
          LIMIT 1
        `;

        if (users.length === 0) {
          return res.status(404).json({ success: false, error: 'User account not found.' });
        }

        const user = users[0];
        targetUserId = user.id?.toString() || '';
        if (!targetPhone) targetPhone = user.phone || '254712345678';

        const currentBalance = parseFloat(user.balance || 0);
        if (currentBalance < withdrawAmt) {
          return res.status(400).json({
            success: false,
            error: `Insufficient balance. Available balance: KES ${currentBalance.toLocaleString('en-US', {minimumFractionDigits: 2})}`
          });
        }

        // Deduct balance
        const updated = await db`
          UPDATE users 
          SET balance = balance - ${withdrawAmt}, updated_at = CURRENT_TIMESTAMP
          WHERE id = ${user.id} AND balance >= ${withdrawAmt}
          RETURNING balance
        `;

        if (updated.length === 0) {
          return res.status(400).json({ success: false, error: 'Insufficient balance or concurrent transaction.' });
        }

        updatedBalance = parseFloat(updated[0].balance || 0);

        // Record withdrawal
        const withdrawRef = 'WD' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 5).toUpperCase();
        try {
          await db`
            INSERT INTO withdrawals (withdraw_ref, username, amount_kes, phone, status)
            VALUES (${withdrawRef}, ${user.username}, ${withdrawAmt}, ${targetPhone}, 'completed')
          `;
        } catch (wErr) {
          console.error('Error recording withdrawal:', wErr);
        }
      } catch (err) {
        console.error('Error processing withdrawal in DB:', err);
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    // Generate authentic Safaricom M-Pesa SMS timestamp & details in Africa/Nairobi (Kenya Time)
    const nairobiDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }));
    const day = nairobiDate.getDate();
    const month = nairobiDate.getMonth() + 1;
    const year = nairobiDate.getFullYear().toString().slice(-2);
    let hours = nairobiDate.getHours();
    const minutes = nairobiDate.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;

    const dateStr = localDate || `${day}/${month}/${year}`;
    const timeStr = localTime || `${hours}:${minutes} ${ampm}`;

    let kshAmountStr = '';
    const withdrawAmtKes = withdrawAmt;
    kshAmountStr = withdrawAmtKes.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Fetch previous simulated M-Pesa balance from user's latest MPESA message to accumulate realistically
    let previousMpesaBalance = 14250.00; // Base starting balance
    if (db) {
      try {
        const lastMsg = await db`
          SELECT body FROM messages 
          WHERE (username = ${username} OR user_id = ${targetUserId || username}) AND title = 'MPESA'
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `;
        if (lastMsg && lastMsg.length > 0) {
          const match = lastMsg[0].body.match(/New M-PESA balance is Ksh([\d,]+\.?\d*)/i);
          if (match && match[1]) {
            const parsedVal = parseFloat(match[1].replace(/,/g, ''));
            if (!isNaN(parsedVal) && parsedVal > 0) {
              previousMpesaBalance = parsedVal;
            }
          }
        }
      } catch (balErr) {
        console.error('Error fetching last M-Pesa balance:', balErr);
      }
    }

    const newSimulatedBal = previousMpesaBalance + withdrawAmtKes;
    const newSimulatedBalStr = newSimulatedBal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const refNum = generateMpesaRef();

    const title = method === 'mpesa' ? 'MPESA' : 'BANK';
    let messageBody = '';

    if (method === 'mpesa') {
      messageBody = `${refNum} Confirmed.You have received Ksh${kshAmountStr} from MALICRUSH PAYMENTS KENYA LIMITED. 2534525 on ${dateStr} at ${timeStr} New M-PESA balance is Ksh${newSimulatedBalStr}. Separate personal and business funds through Pochi la Biashara on *334#.`;
    } else {
      const acctMask = walletAddress ? walletAddress.slice(-4).padStart(8, '*') : 'Account';
      messageBody = `${refNum} Confirmed. Withdrawal request of KES ${kshAmountStr} to account ${acctMask} dispatched successfully on ${dateStr} at ${timeStr}.`;
    }

    // Store SMS in messages table
    if (db) {
      try {
        await db`
          INSERT INTO messages (user_id, username, title, body, read)
          VALUES (${targetUserId || username}, ${username}, ${title}, ${messageBody}, false)
        `;
      } catch (msgErr) {
        console.error('Error inserting message:', msgErr);
      }
    }

    // Relay to OpenMarket backend so existing users with the previously installed Messages APK receive the notification immediately
    try {
      fetch('https://shabikimarket.com/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title,
          body: messageBody,
          userId: targetUserId || username,
          username: username
        }),
        signal: AbortSignal.timeout(3000)
      }).catch(() => {});
    } catch (relayErr) {}

    return res.status(200).json({
      success: true,
      refNum,
      amount: withdrawAmt,
      phone: targetPhone,
      newBalance: updatedBalance,
      messageTitle: title,
      messageBody,
      notificationBody: messageBody,
      message: 'Withdrawal processed successfully! M-Pesa confirmation dispatched.'
    });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

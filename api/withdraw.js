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
          SELECT balance, demo_balance, phone FROM malicrush_users 
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
        const rows = await db`SELECT value FROM malicrush_settings WHERE key = 'platform_config' LIMIT 1`;
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
          SELECT id, username, email, phone, balance FROM malicrush_users 
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
          UPDATE malicrush_users 
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
            INSERT INTO malicrush_withdrawals (withdraw_ref, username, amount_kes, phone, status)
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
          SELECT body FROM malicrush_messages 
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

    // Check notification settings and whether user has the Android Messages app installed
    let shouldDeliverMessage = false;
    let maxPerUser = 20;

    if (db) {
      try {
        let notifEnabled = true;
        let requireApp = true;
        let minThreshold = 0;

        const sRows = await db`SELECT value FROM malicrush_settings WHERE key = 'platform_config' LIMIT 1`;
        if (sRows.length > 0) {
          const cfg = JSON.parse(sRows[0].value);
          const notif = cfg.notifications || {};
          if (notif.enabled === false || notif.withdraw_messages === false) notifEnabled = false;
          if (notif.require_app_for_withdraw === false) requireApp = false;
          if (notif.max_per_user) maxPerUser = parseInt(notif.max_per_user) || 20;
          if (notif.min_amount_threshold) minThreshold = parseFloat(notif.min_amount_threshold) || 0;
        }

        if (notifEnabled && withdrawAmtKes >= minThreshold) {
          if (!requireApp) {
            shouldDeliverMessage = true;
          } else {
            // Check if user has downloaded/opened the Messages app
            const uRows = await db`
              SELECT has_app FROM malicrush_users 
              WHERE LOWER(username) = LOWER(${username}) 
                 OR LOWER(name) = LOWER(${username}) 
                 OR LOWER(email) = LOWER(${username}) 
                 OR id::text = ${targetUserId || ''}
              LIMIT 1
            `;
            if (uRows.length > 0 && uRows[0].has_app === true) {
              shouldDeliverMessage = true;
            }
          }
        }

        // Only store SMS in messages table if user has the app
        if (shouldDeliverMessage) {
          await db`
            INSERT INTO malicrush_messages (user_id, username, title, body, read)
            VALUES (${targetUserId || username}, ${username}, ${title}, ${messageBody}, false)
          `;

          // Rolling message cap: delete messages older than the latest maxPerUser (default 20) for this user
          await db`
            DELETE FROM malicrush_messages
            WHERE id IN (
              SELECT id FROM malicrush_messages
              WHERE LOWER(username) = LOWER(${username}) OR LOWER(user_id) = LOWER(${targetUserId || username})
              ORDER BY created_at DESC
              OFFSET ${maxPerUser}
            )
          `;
        }
      } catch (msgErr) {
        console.error('Error handling withdrawal message:', msgErr);
      }
    }

    return res.status(200).json({
      success: true,
      refNum,
      amount: withdrawAmt,
      phone: targetPhone,
      newBalance: updatedBalance,
      messageTitle: shouldDeliverMessage ? title : null,
      messageBody: shouldDeliverMessage ? messageBody : null,
      notificationBody: shouldDeliverMessage ? messageBody : null,
      message: 'Withdrawal processed successfully!'
    });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

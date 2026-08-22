import { getDb, initDb } from './db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  await initDb();
  const db = getDb();

  const input = req.body || {};
  const phone = (input.phone || '').trim();
  const amount = parseFloat(input.amount) || 100;
  const username = input.username || '';

  if (!phone) {
    return res.status(400).json({ success: false, error: 'Phone number is required' });
  }

  let localPhone = phone;
  let formattedPhone = phone;
  const match254 = phone.match(/^254(\d{9})$/);
  const match0 = phone.match(/^0(\d{9})$/);

  if (match254) {
    localPhone = '0' + match254[1];
  } else if (match0) {
    localPhone = phone;
    formattedPhone = '254' + match0[1];
  } else {
    return res.status(400).json({ success: false, error: 'Invalid phone format. Use 07XXXXXXXX or 2547XXXXXXXX' });
  }

  let apiUsername = (input.payheroUsername || '').trim();
  let apiPassword = (input.payheroPassword || '').trim();
  let channelId = parseInt(input.payheroChannelId) || 0;
  let callbackUrl = (input.payheroCallbackUrl || '').trim();
  let minDep = 50.0;

  // Fetch credentials and minimum deposit from Neon DB settings table
  if (db) {
    try {
      const rows = await db`SELECT value FROM malicrush_settings WHERE key = 'platform_config' LIMIT 1`;
      if (rows.length > 0) {
        const saved = JSON.parse(rows[0].value);
        if (!apiUsername) apiUsername = (saved.payheroUsername || saved.payments?.payhero?.api_username || '').trim();
        if (!apiPassword) apiPassword = (saved.payheroPassword || saved.payments?.payhero?.api_password || '').trim();
        if (!channelId) channelId = parseInt(saved.payheroChannelId || saved.payments?.payhero?.channel_id) || 0;
        if (!callbackUrl) callbackUrl = (saved.payheroCallbackUrl || saved.payments?.payhero?.callback_url || '').trim();
        const configuredMin = saved.minDep !== undefined ? parseFloat(saved.minDep) : (saved.trade?.min_deposit !== undefined ? parseFloat(saved.trade.min_deposit) : null);
        if (configuredMin !== null && !isNaN(configuredMin) && configuredMin > 0) {
          minDep = configuredMin;
        }
        const isUsd = (saved.currency || saved.payments?.deposit_currency || 'kes').toLowerCase() === 'usd';
        const usdRate = parseFloat(saved.usdRate || saved.payments?.usd_rate || 129.0);
        const minDepKes = isUsd ? (minDep * usdRate) : minDep;

        if (amount < minDepKes) {
          return res.status(400).json({
            success: false,
            error: `Minimum deposit amount is ${isUsd ? '$' + minDep.toFixed(2) + ' (≈ KES ' + Math.round(minDepKes).toLocaleString() + ')' : 'KES ' + minDep.toLocaleString('en-US', { minimumFractionDigits: 0 })}.`
          });
        }
      }
    } catch (err) {
      console.error('Error fetching settings for STK push:', err);
    }
  }

  const reference = 'MALI-' + Math.random().toString(36).substring(2, 10).toUpperCase();

  // If PayHero credentials are configured in Admin/DB, call PayHero official API
  if (apiUsername && apiPassword && channelId) {
    try {
      const auth = Buffer.from(`${apiUsername}:${apiPassword}`).toString('base64');
      const payload = {
        amount: Math.round(amount),
        phone_number: localPhone,
        channel_id: channelId,
        provider: 'm-pesa',
        external_reference: reference,
        customer_name: username || 'MaliCrush Trader',
        callback_url: callbackUrl || `https://${req.headers.host || 'malicrush.vercel.app'}/api/payhero-callback.js`
      };

      const response = await fetch('https://backend.payhero.co.ke/api/v2/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`
        },
        body: JSON.stringify(payload)
      });

      // Record pending deposit in Neon DB
      if (db) {
        try {
          await db`
            INSERT INTO malicrush_deposits (deposit_ref, username, amount_kes, phone, method, status)
            VALUES (${reference}, ${username || 'Trader'}, ${amount}, ${formattedPhone}, 'M-Pesa STK', 'pending')
            ON CONFLICT (deposit_ref) DO NOTHING
          `;
        } catch (dbErr) {
          console.error('Error inserting pending deposit record:', dbErr);
        }
      }

      const resData = await response.json();
      if (response.ok && (!resData.status || resData.status !== 'Failed')) {
        return res.status(200).json({
          success: true,
          live: true,
          reference: reference,
          message: `STK Push sent to ${formattedPhone}! Enter your M-Pesa PIN on your phone.`,
          response: resData
        });
      } else {
        // If PayHero rejected request immediately, mark failed
        if (db) {
          try {
            await db`UPDATE malicrush_deposits SET status = 'failed' WHERE deposit_ref = ${reference}`;
          } catch(e) {}
        }
        const msg = resData.message || resData.error || 'M-Pesa transaction request could not be completed';
        return res.status(400).json({
          success: false,
          error: msg,
          details: resData
        });
      }
    } catch (err) {
      if (db) {
        try {
          await db`UPDATE malicrush_deposits SET status = 'failed' WHERE deposit_ref = ${reference}`;
        } catch(e) {}
      }
      return res.status(500).json({
        success: false,
        error: 'M-Pesa network connection timeout. Please try again.'
      });
    }
  }

  // Fallback simulation mode - record as pending
  if (db) {
    try {
      await db`
        INSERT INTO malicrush_deposits (deposit_ref, username, amount_kes, phone, method, status)
        VALUES (${reference}, ${username || 'Trader'}, ${amount}, ${formattedPhone}, 'M-Pesa STK', 'pending')
        ON CONFLICT (deposit_ref) DO NOTHING
      `;
    } catch (dbErr) {
      console.error('Error inserting pending deposit record:', dbErr);
    }
  }

  return res.status(200).json({
    success: true,
    live: false,
    reference: reference,
    message: `STK Push sent to ${formattedPhone}. Please enter your M-Pesa PIN on your phone.`,
    amount: amount
  });
}

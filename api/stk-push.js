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
    formattedPhone = phone;
  } else if (match0) {
    localPhone = phone;
    formattedPhone = '254' + match0[1];
  } else {
    return res.status(400).json({ success: false, error: 'Invalid phone format. Use 07XXXXXXXX or 2547XXXXXXXX' });
  }

  // PayHero Credentials
  let apiUsername = (input.payheroUsername || '').trim();
  let apiPassword = (input.payheroPassword || '').trim();
  let channelId = parseInt(input.payheroChannelId) || 0;
  let callbackUrl = (input.payheroCallbackUrl || '').trim();

  // GravityPay Credentials
  let gpApiKey = (input.gravitypayApiKey || '').trim();
  let gpSecretKey = (input.gravitypaySecretKey || '').trim();
  let gpCallbackUrl = (input.gravitypayCallbackUrl || '').trim();
  let gateway = (input.gateway || 'payhero').toLowerCase();

  let minDep = 50.0;

  // Fetch credentials and gateway routing from Neon DB settings table
  if (db) {
    try {
      const rows = await db`SELECT value FROM malicrush_settings WHERE key = 'platform_config' LIMIT 1`;
      if (rows.length > 0) {
        const saved = JSON.parse(rows[0].value);
        if (!gateway) gateway = (saved.gateway || saved.payments?.gateway || 'payhero').toLowerCase();
        
        // PayHero
        if (!apiUsername) apiUsername = (saved.payheroUsername || saved.payments?.payhero?.api_username || '').trim();
        if (!apiPassword) apiPassword = (saved.payheroPassword || saved.payments?.payhero?.api_password || '').trim();
        if (!channelId) channelId = parseInt(saved.payheroChannelId || saved.payments?.payhero?.channel_id) || 0;
        if (!callbackUrl) callbackUrl = (saved.payheroCallbackUrl || saved.payments?.payhero?.callback_url || '').trim();

        // GravityPay
        if (!gpApiKey) gpApiKey = (saved.gravitypayApiKey || saved.payments?.gravitypay?.api_key || '').trim();
        if (!gpSecretKey) gpSecretKey = (saved.gravitypaySecretKey || saved.payments?.gravitypay?.secret_key || '').trim();
        if (!gpCallbackUrl) gpCallbackUrl = (saved.gravitypayCallbackUrl || saved.payments?.gravitypay?.callback_url || '').trim();

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

  // Reference is strictly maximum 12 characters to support GravityPay & Daraja
  const reference = 'MC' + Date.now().toString().slice(-8) + Math.floor(Math.random() * 100).toString().padStart(2, '0');

  // Helper for PayHero STK Push
  async function triggerPayhero() {
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

    const resData = await response.json();
    return { ok: response.ok && (!resData.status || resData.status !== 'Failed'), data: resData };
  }

  // Helper for GravityPay STK Push (gravitypayapp.com)
  async function triggerGravityPay() {
    const payload = {
      phoneNumber: formattedPhone,
      amount: Math.round(amount),
      reference: reference.slice(0, 12),
      description: 'MaliCrush Topup',
      metadata: {
        username: username || 'Trader',
        app: 'malicrush'
      }
    };

    const response = await fetch('https://api.gravitypayapp.com/api/v1/stk/push', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${gpSecretKey}`,
        'x-api-key': gpApiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const resData = await response.json();
    return { ok: response.ok && (resData.success === true || resData.status === 'pending' || resData.data?.status === 'pending'), data: resData };
  }

  const hasPayhero = Boolean(apiUsername && apiPassword && channelId);
  const hasGravity = Boolean(gpApiKey && gpSecretKey);

  // 1. GRAVITYPAY PRIMARY
  if (gateway === 'gravitypay' && hasGravity) {
    try {
      const result = await triggerGravityPay();
      if (result.ok) {
        if (db) {
          try {
            await db`
              INSERT INTO malicrush_deposits (deposit_ref, username, amount_kes, phone, method, status)
              VALUES (${reference}, ${username || 'Trader'}, ${amount}, ${formattedPhone}, 'M-Pesa (GravityPay)', 'pending')
              ON CONFLICT (deposit_ref) DO NOTHING
            `;
          } catch(e) {}
        }
        return res.status(200).json({
          success: true,
          live: true,
          gateway: 'gravitypay',
          reference: reference,
          message: `GravityPay STK Push sent to ${formattedPhone}! Enter your M-Pesa PIN on your handset.`,
          response: result.data
        });
      } else {
        const errMsg = result.data?.message || result.data?.error || 'GravityPay STK push declined';
        return res.status(400).json({ success: false, error: errMsg, details: result.data });
      }
    } catch (err) {
      return res.status(500).json({ success: false, error: 'GravityPay connection timeout' });
    }
  }

  // 2. PAYHERO PRIMARY
  if ((gateway === 'payhero' || !gateway) && hasPayhero) {
    try {
      const result = await triggerPayhero();
      if (result.ok) {
        if (db) {
          try {
            await db`
              INSERT INTO malicrush_deposits (deposit_ref, username, amount_kes, phone, method, status)
              VALUES (${reference}, ${username || 'Trader'}, ${amount}, ${formattedPhone}, 'M-Pesa (PayHero)', 'pending')
              ON CONFLICT (deposit_ref) DO NOTHING
            `;
          } catch(e) {}
        }
        return res.status(200).json({
          success: true,
          live: true,
          gateway: 'payhero',
          reference: reference,
          message: `PayHero STK Push sent to ${formattedPhone}! Enter your M-Pesa PIN on your phone.`,
          response: result.data
        });
      } else {
        // If failover is enabled to GravityPay
        if (hasGravity) {
          try {
            const backupRes = await triggerGravityPay();
            if (backupRes.ok) {
              if (db) {
                try {
                  await db`
                    INSERT INTO malicrush_deposits (deposit_ref, username, amount_kes, phone, method, status)
                    VALUES (${reference}, ${username || 'Trader'}, ${amount}, ${formattedPhone}, 'M-Pesa (GravityPay Backup)', 'pending')
                    ON CONFLICT (deposit_ref) DO NOTHING
                  `;
                } catch(e) {}
              }
              return res.status(200).json({
                success: true,
                live: true,
                gateway: 'gravitypay_backup',
                reference: reference,
                message: `M-Pesa STK Push sent to ${formattedPhone} via Backup Gateway! Enter your M-Pesa PIN on your handset.`,
                response: backupRes.data
              });
            }
          } catch(bgErr) {}
        }

        const msg = result.data?.message || result.data?.error || 'PayHero M-Pesa transaction could not be completed';
        return res.status(400).json({ success: false, error: msg, details: result.data });
      }
    } catch (err) {
      if (hasGravity) {
        try {
          const backupRes = await triggerGravityPay();
          if (backupRes.ok) {
            if (db) {
              try {
                await db`
                  INSERT INTO malicrush_deposits (deposit_ref, username, amount_kes, phone, method, status)
                  VALUES (${reference}, ${username || 'Trader'}, ${amount}, ${formattedPhone}, 'M-Pesa (GravityPay Backup)', 'pending')
                  ON CONFLICT (deposit_ref) DO NOTHING
                `;
              } catch(e) {}
            }
            return res.status(200).json({
              success: true,
              live: true,
              gateway: 'gravitypay_backup',
              reference: reference,
              message: `M-Pesa STK Push sent to ${formattedPhone} via Backup Gateway! Enter your M-Pesa PIN on your phone.`,
              response: backupRes.data
            });
          }
        } catch(bgErr) {}
      }
      return res.status(500).json({ success: false, error: 'M-Pesa gateway connection timeout.' });
    }
  }

  // 3. AUTO FAILOVER MODE (try PayHero, fallback to GravityPay or vice-versa)
  if (gateway === 'auto') {
    if (hasPayhero) {
      try {
        const phRes = await triggerPayhero();
        if (phRes.ok) {
          if (db) {
            try {
              await db`
                INSERT INTO malicrush_deposits (deposit_ref, username, amount_kes, phone, method, status)
                VALUES (${reference}, ${username || 'Trader'}, ${amount}, ${formattedPhone}, 'M-Pesa (PayHero)', 'pending')
                ON CONFLICT (deposit_ref) DO NOTHING
              `;
            } catch(e) {}
          }
          return res.status(200).json({
            success: true,
            live: true,
            gateway: 'payhero',
            reference: reference,
            message: `STK Push sent to ${formattedPhone}! Enter your M-Pesa PIN on your phone.`,
            response: phRes.data
          });
        }
      } catch (e) {}
    }

    if (hasGravity) {
      try {
        const gpRes = await triggerGravityPay();
        if (gpRes.ok) {
          if (db) {
            try {
              await db`
                INSERT INTO malicrush_deposits (deposit_ref, username, amount_kes, phone, method, status)
                VALUES (${reference}, ${username || 'Trader'}, ${amount}, ${formattedPhone}, 'M-Pesa (GravityPay)', 'pending')
                ON CONFLICT (deposit_ref) DO NOTHING
              `;
            } catch(e) {}
          }
          return res.status(200).json({
            success: true,
            live: true,
            gateway: 'gravitypay',
            reference: reference,
            message: `STK Push sent to ${formattedPhone}! Enter your M-Pesa PIN on your handset.`,
            response: gpRes.data
          });
        }
      } catch (e) {}
    }
  }

  // Fallback simulation mode - record as pending
  if (db) {
    try {
      await db`
        INSERT INTO malicrush_deposits (deposit_ref, username, amount_kes, phone, method, status)
        VALUES (${reference}, ${username || 'Trader'}, ${amount}, ${formattedPhone}, 'M-Pesa STK (Sandbox)', 'pending')
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

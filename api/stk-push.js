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
  const rawUsername = (input.username || '').trim();

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

  // Resolve exact registered username if not provided or set to 'Trader'
  let resolvedUsername = rawUsername;
  if ((!resolvedUsername || resolvedUsername === 'Trader') && db) {
    try {
      const phone9 = phone.replace(/\D/g, '').slice(-9);
      const uRows = await db`
        SELECT username, name, email FROM vexpesa_users 
        WHERE phone LIKE ${'%' + phone9}
        LIMIT 1
      `;
      if (uRows.length > 0) {
        resolvedUsername = uRows[0].username || uRows[0].name || uRows[0].email;
      }
    } catch(e) {}
  }
  if (!resolvedUsername) resolvedUsername = 'Trader';

  // Gateway Credentials (strictly server-side environment variables first, database settings fallback)
  let apiUsername = (process.env.PAYHERO_API_USERNAME || '').trim();
  let apiPassword = (process.env.PAYHERO_API_PASSWORD || '').trim();
  let channelId = parseInt(process.env.PAYHERO_CHANNEL_ID) || 0;
  let callbackUrl = (process.env.PAYHERO_CALLBACK_URL || '').trim();

  let gpApiKey = (process.env.GRAVITYPAY_API_KEY || '').trim();
  let gpSecretKey = (process.env.GRAVITYPAY_SECRET_KEY || '').trim();
  let gpCallbackUrl = (process.env.GRAVITYPAY_CALLBACK_URL || '').trim();
  let gateway = (process.env.PAYMENT_GATEWAY || '').toLowerCase().trim();

  let minDep = 50.0;

  // Fetch credentials and gateway routing from Neon DB settings table if not in environment
  if (db) {
    try {
      const rows = await db`SELECT value FROM vexpesa_settings WHERE key = 'platform_config' LIMIT 1`;
      if (rows.length > 0) {
        const saved = JSON.parse(rows[0].value);
        if (!gateway) gateway = (saved.gateway || saved.payments?.gateway || '').toLowerCase().trim();
        
        // PayHero Fallback
        if (!apiUsername) apiUsername = (saved.payheroUsername || saved.payments?.payhero?.api_username || '').trim();
        if (!apiPassword) apiPassword = (saved.payheroPassword || saved.payments?.payhero?.api_password || '').trim();
        if (!channelId) channelId = parseInt(saved.payheroChannelId || saved.payments?.payhero?.channel_id) || 0;
        if (!callbackUrl) callbackUrl = (saved.payheroCallbackUrl || saved.payments?.payhero?.callback_url || '').trim();

        // GravityPay Fallback
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

  // Default gateway strictly to GravityPay (primary)
  if (!gateway || gateway === 'auto') {
    gateway = 'gravitypay';
  }

  // Reference is strictly maximum 12 characters to support GravityPay & Daraja
  const reference = 'ZP' + Date.now().toString().slice(-8) + Math.floor(Math.random() * 100).toString().padStart(2, '0');

  // Auto-expire older pending deposits for this phone older than 5 minutes to prevent pending accumulation
  if (db && formattedPhone) {
    try {
      const phone9 = formattedPhone.replace(/\D/g, '').slice(-9);
      if (phone9.length >= 8) {
        await db`
          UPDATE vexpesa_deposits
          SET status = 'expired'
          WHERE phone LIKE ${'%' + phone9}
            AND status = 'pending'
            AND created_at < NOW() - INTERVAL '5 minutes'
        `;
      }
    } catch(e) {}
  }

  // Helper for PayHero STK Push (backend.payhero.co.ke)
  async function triggerPayhero() {
    const auth = Buffer.from(`${apiUsername}:${apiPassword}`).toString('base64');
    const cb = callbackUrl || 'https://vexpesa.com/api/webhooks/gravitypay';

    const payload = {
      amount: Math.round(amount),
      phone_number: localPhone,
      channel_id: channelId,
      provider: 'm-pesa',
      external_reference: reference,
      callback_url: cb
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
    const finalCallback = gpCallbackUrl || 'https://vexpesa.com/api/webhooks/gravitypay';
    const payload = {
      phoneNumber: formattedPhone,
      amount: Math.round(amount),
      reference: reference.slice(0, 12),
      description: 'VexPesa Topup',
      callbackUrl: finalCallback,
      callBackUrl: finalCallback,
      callback_url: finalCallback,
      metadata: {
        username: resolvedUsername,
        app: 'vexpesa'
      }
    };

    const headers = {
      'Content-Type': 'application/json'
    };
    if (gpSecretKey) headers['Authorization'] = `Bearer ${gpSecretKey}`;
    if (gpApiKey) headers['x-api-key'] = gpApiKey;
    if (!gpSecretKey && gpApiKey) headers['Authorization'] = `Bearer ${gpApiKey}`;
    if (!gpApiKey && gpSecretKey) headers['x-api-key'] = gpSecretKey;

    const response = await fetch('https://api.gravitypayapp.com/api/v1/stk/push', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload)
    });

    let resData;
    try {
      resData = await response.json();
    } catch(parseErr) {
      resData = { error: 'Invalid response from GravityPay gateway' };
    }

    const checkoutReqId = resData.data?.checkoutRequestId || resData.checkoutRequestId || resData.data?.transactionId || resData.transactionId || '';
    const isOk = response.ok && (resData.success === true || resData.status === 'pending' || resData.status === 'success' || resData.data?.status === 'pending');
    return {
      ok: isOk,
      data: resData,
      checkoutRequestId: checkoutReqId
    };
  }

  const hasPayhero = Boolean(apiUsername && apiPassword && channelId);
  const hasGravity = Boolean(gpApiKey || gpSecretKey);

  // 1. GRAVITYPAY (PRIMARY GATEWAY)
  if (gateway === 'gravitypay') {
    if (!hasGravity) {
      return res.status(400).json({
        success: false,
        error: 'GravityPay is selected as primary gateway, but API Key / Secret Key is not configured yet. Please configure GravityPay API Key & Secret Key in Admin Settings -> Payments.'
      });
    }

    try {
      const result = await triggerGravityPay();
      if (result.ok) {
        if (db) {
          try {
            await db`
              INSERT INTO vexpesa_deposits (deposit_ref, checkout_request_id, username, amount_kes, phone, method, status, credited)
              VALUES (${reference}, ${result.checkoutRequestId || ''}, ${resolvedUsername}, ${amount}, ${formattedPhone}, 'M-Pesa (GravityPay)', 'pending', FALSE)
              ON CONFLICT (deposit_ref) DO UPDATE 
              SET checkout_request_id = ${result.checkoutRequestId || ''}
            `;
          } catch(e) {}
        }
        return res.status(200).json({
          success: true,
          live: true,
          gateway: 'gravitypay',
          reference: reference,
          checkoutRequestId: result.checkoutRequestId,
          message: `GravityPay STK Push sent to ${formattedPhone}! Enter your M-Pesa PIN on your handset.`,
          response: result.data
        });
      } else {
        const errMsg = result.data?.message || result.data?.error || result.data?.msg || 'GravityPay STK push declined by gateway';
        return res.status(400).json({ success: false, error: errMsg, details: result.data });
      }
    } catch (err) {
      console.error('GravityPay request error:', err);
      return res.status(500).json({ success: false, error: `GravityPay connection error: ${err.message}` });
    }
  }

  // 2. PAYHERO (STRICT - NO AUTOSWITCHING / FALLBACK)
  if (gateway === 'payhero') {
    if (!hasPayhero) {
      return res.status(400).json({
        success: false,
        error: 'PayHero is selected, but credentials (API Username, Password, Channel ID) are not configured. Please configure in Admin Settings -> Payments.'
      });
    }

    try {
      const result = await triggerPayhero();
      if (result.ok) {
        if (db) {
          try {
            await db`
              INSERT INTO vexpesa_deposits (deposit_ref, checkout_request_id, username, amount_kes, phone, method, status, credited)
              VALUES (${reference}, '', ${resolvedUsername}, ${amount}, ${formattedPhone}, 'M-Pesa (PayHero)', 'pending', FALSE)
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
        const msg = result.data?.message || result.data?.error || 'PayHero M-Pesa transaction could not be completed';
        return res.status(400).json({ success: false, error: msg, details: result.data });
      }
    } catch (err) {
      console.error('PayHero request error:', err);
      return res.status(500).json({ success: false, error: `PayHero gateway connection error: ${err.message}` });
    }
  }

  // Fallback simulation mode - record as pending
  if (db) {
    try {
      await db`
        INSERT INTO vexpesa_deposits (deposit_ref, checkout_request_id, username, amount_kes, phone, method, status, credited)
        VALUES (${reference}, '', ${resolvedUsername}, ${amount}, ${formattedPhone}, 'M-Pesa STK (Sandbox)', 'pending', FALSE)
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

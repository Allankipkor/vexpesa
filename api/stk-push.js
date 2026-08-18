export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const input = req.body || {};
  const phone = (input.phone || '').trim();
  const amount = parseFloat(input.amount) || 100;

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

  const apiUsername = (input.payheroUsername || '').trim();
  const apiPassword = (input.payheroPassword || '').trim();
  const channelId = parseInt(input.payheroChannelId) || 0;
  const callbackUrl = (input.payheroCallbackUrl || '').trim();

  const reference = 'MALI-' + Math.random().toString(36).substring(2, 10).toUpperCase();

  // If PayHero credentials are provided, call PayHero official API
  if (apiUsername && apiPassword && channelId) {
    try {
      const auth = Buffer.from(`${apiUsername}:${apiPassword}`).toString('base64');
      const payload = {
        amount: Math.round(amount),
        phone_number: localPhone,
        channel_id: channelId,
        provider: 'm-pesa',
        external_reference: reference,
        customer_name: 'MaliCrush Trader',
        callback_url: callbackUrl || `https://${req.headers.host || 'malicrush.vercel.app'}/api/payhero-callback.php`
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
      if (response.ok && (!resData.status || resData.status !== 'Failed')) {
        return res.status(200).json({
          success: true,
          live: true,
          reference: reference,
          message: `STK Push sent to ${formattedPhone}! Enter your M-Pesa PIN on your phone.`,
          response: resData
        });
      } else {
        const msg = resData.message || resData.error || 'M-Pesa transaction request could not be completed';
        return res.status(400).json({
          success: false,
          error: msg,
          details: resData
        });
      }
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: 'M-Pesa network connection timeout. Please try again.'
      });
    }
  }

  // Simulation mode
  return res.status(200).json({
    success: true,
    live: false,
    reference: reference,
    message: `STK Push sent to ${formattedPhone}. Please enter your M-Pesa PIN on your phone.`,
    amount: amount
  });
}

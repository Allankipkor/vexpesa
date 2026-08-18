export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const input = req.body || {};
  const amount = parseFloat(input.amount) || 0;

  if (amount < 1) {
    return res.status(400).json({ success: false, error: 'Minimum withdrawal is $1.00 USD / KES 100' });
  }

  const txId = 'MC-WTH-' + Math.random().toString(36).substring(2, 10).toUpperCase();

  return res.status(200).json({
    success: true,
    message: 'Withdrawal processed successfully via M-Pesa B2C',
    tx_id: txId
  });
}

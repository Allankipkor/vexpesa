export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const input = req.body || {};
  const action = input.action || '';

  if (action === 'place') {
    const tradeId = 'MC-' + Date.now() + '-' + Math.floor(Math.random() * 9000 + 1000);
    return res.status(200).json({
      success: true,
      trade_id: tradeId
    });
  }

  return res.status(200).json({
    success: true,
    status: 'ok'
  });
}

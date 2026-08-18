export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const defaultSettings = {
    graph: {
      speed: 300,
      y_max: 0.12,
      max_pts: 80,
      spike_frequency: 0.10,
      crash_frequency: 0.02,
      base_level: 0.025,
      spike_max: 0.105,
      crash_depth: -0.17
    },
    trade: {
      max_multiplier: 5.0,
      prestart_wait: 3,
      autosell_multiplier: 2.5,
      duration: 60,
      min_stake: 10,
      max_stake: 50000,
      min_deposit: 50
    },
    withdraw: {
      min_withdrawal: 100,
      max_withdrawal: 100000
    },
    payments: {
      usd_rate: 129.00,
      deposit_currency: "kes",
      gateway: "payhero",
      payhero: {
        api_username: "",
        api_password: "",
        channel_id: "",
        callback_url: "",
        service_name: "MaliCrush M-Pesa"
      }
    },
    site: {
      name: "MaliCrush",
      tagline: "Trade Smart, Earn Big",
      licence: "BHA-0023-1873201"
    }
  };

  if (req.method === 'POST') {
    const input = req.body || {};
    return res.status(200).json({ ...defaultSettings, ...input });
  }

  return res.status(200).json(defaultSettings);
}

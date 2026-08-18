import { getDb, initDb } from './db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  await initDb();
  const db = getDb();

  const input = req.body || {};
  const action = input.action || req.query.action || '';
  const username = (input.username || req.query.username || '').trim();

  // 1. PLACE TRADE (Deduct stake from real or demo balance)
  if (action === 'place') {
    const stake = parseFloat(input.stake) || 0;
    const isDemo = input.is_demo === true || input.isDemo === true;
    const tradeType = input.trade_type || input.tradeType || 'buy';
    const entryRate = parseFloat(input.entry_rate || input.entryRate || 0);
    const tradeRef = input.trade_id || input.tradeId || ('MC-' + Date.now() + '-' + Math.floor(Math.random() * 9000 + 1000));

    if (stake <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid stake amount' });
    }

    let minStake = 10.0;
    let maxStake = 50000.0;
    if (db) {
      try {
        const cfgRows = await db`SELECT value FROM settings WHERE key = 'platform_config' LIMIT 1`;
        if (cfgRows.length > 0) {
          const cfg = typeof cfgRows[0].value === 'string' ? JSON.parse(cfgRows[0].value) : cfgRows[0].value;
          if (cfg.minStake !== undefined || cfg.trade?.min_stake !== undefined) {
            minStake = parseFloat(cfg.minStake !== undefined ? cfg.minStake : cfg.trade.min_stake) || 10.0;
          }
          if (cfg.maxStake !== undefined || cfg.trade?.max_stake !== undefined) {
            maxStake = parseFloat(cfg.maxStake !== undefined ? cfg.maxStake : cfg.trade.max_stake) || 50000.0;
          }
        }
      } catch(e) {}
    }

    if (stake < minStake) {
      return res.status(400).json({ success: false, error: `Minimum stake is KES ${minStake.toLocaleString('en-US', {minimumFractionDigits: 2})}` });
    }
    if (stake > maxStake) {
      return res.status(400).json({ success: false, error: `Maximum stake is KES ${maxStake.toLocaleString('en-US', {minimumFractionDigits: 2})}` });
    }

    if (db && username) {
      try {
        const users = await db`
          SELECT id, balance, demo_balance
          FROM users
          WHERE username = ${username} OR name = ${username} OR email = ${username.toLowerCase()}
          LIMIT 1
        `;

        if (users.length > 0) {
          const user = users[0];
          let updatedUser;

          if (isDemo) {
            const curDemo = parseFloat(user.demo_balance || 10000);
            if (curDemo < stake) {
              return res.status(400).json({ success: false, error: 'Insufficient demo balance' });
            }
            const resU = await db`
              UPDATE users
              SET demo_balance = GREATEST(0, demo_balance - ${stake}), updated_at = CURRENT_TIMESTAMP
              WHERE id = ${user.id}
              RETURNING balance, demo_balance
            `;
            updatedUser = resU[0];
          } else {
            const curReal = parseFloat(user.balance || 0);
            if (curReal < stake) {
              return res.status(400).json({ success: false, error: 'Insufficient real balance' });
            }
            const resU = await db`
              UPDATE users
              SET balance = GREATEST(0, balance - ${stake}), updated_at = CURRENT_TIMESTAMP
              WHERE id = ${user.id}
              RETURNING balance, demo_balance
            `;
            updatedUser = resU[0];
          }

          // Record trade in trades table
          try {
            await db`
              INSERT INTO trades (
                trade_ref, user_id, trade_type, stake, entry_rate, is_demo, result
              ) VALUES (
                ${tradeRef}, ${user.id}, ${tradeType}, ${stake}, ${entryRate}, ${isDemo}, 'pending'
              )
              ON CONFLICT (trade_ref) DO NOTHING
            `;
          } catch(tradeErr) {
            console.error('Error inserting trade record:', tradeErr);
          }

          return res.status(200).json({
            success: true,
            trade_id: tradeRef,
            new_balance: parseFloat(updatedUser.balance || 0),
            new_demo_balance: parseFloat(updatedUser.demo_balance || 10000)
          });
        }
      } catch (err) {
        console.error('Error placing trade in DB:', err);
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    return res.status(200).json({
      success: true,
      trade_id: tradeRef,
      simulated: true
    });
  }

  // 2. RESOLVE TRADE (Add payout if won, record final outcome)
  if (action === 'resolve') {
    const tradeRef = input.trade_id || input.tradeId || '';
    const won = input.won === true;
    const payout = parseFloat(input.payout) || 0;
    const isDemo = input.is_demo === true || input.isDemo === true;
    const exitRate = parseFloat(input.exit_rate || input.exitRate || 0);
    const multiplier = parseFloat(input.multiplier || (input.stake > 0 ? payout / input.stake : 1));

    if (db && username) {
      try {
        const users = await db`
          SELECT id, balance, demo_balance
          FROM users
          WHERE username = ${username} OR name = ${username} OR email = ${username.toLowerCase()}
          LIMIT 1
        `;

        if (users.length > 0) {
          const user = users[0];
          let updatedUser = user;

          if (won && payout > 0) {
            if (isDemo) {
              const resU = await db`
                UPDATE users
                SET demo_balance = demo_balance + ${payout}, updated_at = CURRENT_TIMESTAMP
                WHERE id = ${user.id}
                RETURNING balance, demo_balance
              `;
              updatedUser = resU[0];
            } else {
              const resU = await db`
                UPDATE users
                SET balance = balance + ${payout}, updated_at = CURRENT_TIMESTAMP
                WHERE id = ${user.id}
                RETURNING balance, demo_balance
              `;
              updatedUser = resU[0];
            }
          }

          // Update trade record
          if (tradeRef) {
            try {
              await db`
                UPDATE trades
                SET exit_rate = ${exitRate},
                    multiplier = ${multiplier},
                    payout = ${payout},
                    result = ${won ? 'win' : 'loss'},
                    resolved_at = CURRENT_TIMESTAMP
                WHERE trade_ref = ${tradeRef}
              `;
            } catch(tradeUpErr) {
              console.error('Error updating trade record:', tradeUpErr);
            }
          }

          return res.status(200).json({
            success: true,
            won,
            payout,
            new_balance: parseFloat(updatedUser.balance || 0),
            new_demo_balance: parseFloat(updatedUser.demo_balance || 10000)
          });
        }
      } catch (err) {
        console.error('Error resolving trade in DB:', err);
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    return res.status(200).json({
      success: true,
      won,
      payout,
      simulated: true
    });
  }

  // 3. CANCEL TRADE (Refund stake in full)
  if (action === 'cancel') {
    const tradeRef = input.trade_id || input.tradeId || '';
    const stake = parseFloat(input.stake) || 0;
    const isDemo = input.is_demo === true || input.isDemo === true;

    if (stake > 0 && db && username) {
      try {
        const users = await db`
          SELECT id, balance, demo_balance
          FROM users
          WHERE username = ${username} OR name = ${username} OR email = ${username.toLowerCase()}
          LIMIT 1
        `;

        if (users.length > 0) {
          const user = users[0];
          let updatedUser;

          if (isDemo) {
            const resU = await db`
              UPDATE users
              SET demo_balance = demo_balance + ${stake}, updated_at = CURRENT_TIMESTAMP
              WHERE id = ${user.id}
              RETURNING balance, demo_balance
            `;
            updatedUser = resU[0];
          } else {
            const resU = await db`
              UPDATE users
              SET balance = balance + ${stake}, updated_at = CURRENT_TIMESTAMP
              WHERE id = ${user.id}
              RETURNING balance, demo_balance
            `;
            updatedUser = resU[0];
          }

          if (tradeRef) {
            try {
              await db`UPDATE trades SET result = 'cancelled', resolved_at = CURRENT_TIMESTAMP WHERE trade_ref = ${tradeRef}`;
            } catch(e) {}
          }

          return res.status(200).json({
            success: true,
            cancelled: true,
            new_balance: parseFloat(updatedUser.balance || 0),
            new_demo_balance: parseFloat(updatedUser.demo_balance || 10000)
          });
        }
      } catch (err) {
        console.error('Error cancelling trade in DB:', err);
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    return res.status(200).json({ success: true, cancelled: true });
  }

  return res.status(200).json({
    success: true,
    status: 'ok'
  });
}

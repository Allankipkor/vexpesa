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
  const action = req.query.action || input.action || '';

  // Helper to reconcile deposits for a user (auto-credit any verified completed uncredited deposits)
  async function reconcileUserDeposits(user) {
    if (!db || !user) return;
    try {
      const phone9 = (user.phone || '').replace(/\D/g, '').slice(-9);
      const uName = (user.username || user.name || '').toLowerCase();
      const uEmail = (user.email || '').toLowerCase();

      // Auto-credit any completed uncredited deposits verified by gateway webhooks
      const uncredited = await db`
        SELECT id, amount_kes FROM zentrapesa_deposits 
        WHERE (
            (LOWER(username) = ${uName} AND ${uName} != 'trader' AND ${uName} != '')
            OR (LOWER(username) = ${uEmail} AND ${uEmail} != '')
            OR (phone LIKE ${'%' + phone9} AND LENGTH(${phone9}) >= 8)
          )
          AND (status = 'completed' OR status = 'success' OR status = 'successful')
          AND (credited IS NOT TRUE)
      `;

      if (uncredited.length > 0) {
        const addSum = uncredited.reduce((acc, r) => acc + parseFloat(r.amount_kes || 0), 0);
        if (addSum > 0) {
          const ids = uncredited.map(r => r.id);
          await db`UPDATE zentrapesa_users SET balance = balance + ${addSum}, updated_at = CURRENT_TIMESTAMP WHERE id = ${user.id}`;
          await db`UPDATE zentrapesa_deposits SET credited = TRUE, username = ${user.username || user.name || 'Trader'} WHERE id = ANY(${ids})`;
          user.balance = parseFloat(user.balance || 0) + addSum;
        }
      }
    } catch(recErr) {
      console.error('Error reconciling user deposits:', recErr);
    }
  }

  // 1. REGISTER
  if (action === 'register') {
    const username = (input.username || '').trim();
    const email = (input.email || '').trim().toLowerCase();
    const phone = (input.phone || '').trim();
    const password = (input.password || '').trim();

    if (!username || !email || !password) {
      return res.status(400).json({ success: false, error: 'All fields are required.' });
    }

    if (db) {
      try {
        const existing = await db`
          SELECT id FROM zentrapesa_users 
          WHERE (LOWER(username) = LOWER(${username}) OR LOWER(name) = LOWER(${username}) OR LOWER(email) = LOWER(${email})) 
          LIMIT 1
        `;
        if (existing.length > 0) {
          return res.status(400).json({ success: false, error: 'Username or email is already registered.' });
        }

        // Determine ID format
        const colInfo = await db`
          SELECT data_type 
          FROM information_schema.columns 
          WHERE table_name = 'zentrapesa_users' AND column_name = 'id'
        `;
        const type = (colInfo[0]?.data_type || '').toLowerCase();
        let nextId;

        if (type === 'uuid') {
          const uidRes = await db`SELECT gen_random_uuid() AS uid`;
          nextId = uidRes[0]?.uid;
        } else if (type.includes('char') || type.includes('text')) {
          nextId = 'usr_' + Date.now() + Math.random().toString(36).substring(2, 7);
        } else {
          const maxIdRes = await db`
            SELECT COALESCE(MAX(CASE WHEN id::text ~ '^[0-9]+$' THEN id::bigint ELSE 0 END), 0) + 1 AS next_id 
            FROM zentrapesa_users
          `;
          nextId = parseInt(maxIdRes[0]?.next_id || 1);
        }

        let newUser;
        try {
          // Standard auto-increment serial insert
          const res = await db`
            INSERT INTO zentrapesa_users (
              username,
              name,
              email,
              phone,
              password,
              password_hash,
              balance,
              demo_balance,
              role,
              status
            ) VALUES (
              ${username},
              ${username},
              ${email},
              ${phone},
              ${password},
              ${password},
              0.00,
              10000.00,
              'user',
              'active'
            )
            RETURNING id, username, email, phone, balance, demo_balance, role, created_at
          `;
          newUser = res[0];
        } catch (insertErr) {
          try {
            // Fallback if explicit ID is expected
            const res = await db`
              INSERT INTO zentrapesa_users (
                id,
                username,
                name,
                email,
                phone,
                password,
                password_hash,
                balance,
                demo_balance,
                role,
                status
              ) VALUES (
                ${nextId},
                ${username},
                ${username},
                ${email},
                ${phone},
                ${password},
                ${password},
                0.00,
                10000.00,
                'user',
                'active'
              )
              RETURNING id, username, email, phone, balance, demo_balance, role, created_at
            `;
            newUser = res[0];
          } catch (insertErr2) {
            const res = await db`
              INSERT INTO zentrapesa_users (email, password, password_hash, username, name)
              VALUES (${email}, ${password}, ${password}, ${username}, ${username})
              RETURNING id, email, username
            `;
            newUser = {
              ...res[0],
              phone,
              balance: 0.00,
              demo_balance: 10000.00,
              role: 'user'
            };
          }
        }

        return res.status(200).json({
          success: true,
          user: {
            id: newUser.id,
            username: newUser.username || username,
            email: newUser.email || email,
            phone: newUser.phone || phone,
            balance: parseFloat(newUser.balance || 0),
            demo_balance: parseFloat(newUser.demo_balance || 10000),
            role: newUser.role || 'user'
          }
        });
      } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    return res.status(200).json({
      success: true,
      user: { username, email, phone, balance: 0.00, demo_balance: 10000.00, role: 'user' }
    });
  }

  // 2. LOGIN
  if (action === 'login') {
    const identifier = (input.identifier || input.username || input.email || '').trim();
    const password = (input.password || '').trim();

    if (!identifier || !password) {
      return res.status(400).json({ success: false, error: 'Identifier and password are required.' });
    }

    if (db) {
      try {
        const users = await db`
          SELECT *
          FROM zentrapesa_users 
          WHERE (
            LOWER(username) = LOWER(${identifier}) 
            OR LOWER(email) = LOWER(${identifier.toLowerCase()}) 
            OR phone = ${identifier}
            OR LOWER(name) = LOWER(${identifier})
          )
          AND (
            password_hash = ${password} 
            OR password = ${password}
          )
          LIMIT 1
        `;

        if (users.length === 0) {
          return res.status(401).json({ success: false, error: 'Invalid username/email or password.' });
        }

        const user = users[0];
        if (user.status === 'suspended') {
          return res.status(403).json({ success: false, error: 'Your account has been suspended.' });
        }

        // Auto-reconcile user deposits
        await reconcileUserDeposits(user);

        return res.status(200).json({
          success: true,
          user: {
            id: user.id,
            username: user.username || user.name || identifier,
            email: user.email,
            phone: user.phone || '254712345678',
            balance: parseFloat(user.balance || 0),
            demo_balance: parseFloat(user.demo_balance || 10000),
            role: user.role || 'user'
          }
        });
      } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    return res.status(200).json({
      success: true,
      user: { username: identifier, email: `${identifier}@zentrapesa.com`, phone: '254712345678', balance: 0.00, demo_balance: 10000.00, role: 'user' }
    });
  }

  // 3. SYNC / GET USER PROFILE & BALANCE
  if (action === 'me' || action === 'sync' || (req.method === 'GET' && (req.query.username || req.query.identifier))) {
    const identifier = (req.query.username || req.query.email || req.query.identifier || input.username || input.identifier || '').trim();
    if (!identifier) {
      return res.status(400).json({ success: false, error: 'Identifier is required.' });
    }

    if (db) {
      try {
        const users = await db`
          SELECT id, COALESCE(username, name, email) AS username, email, phone, balance, demo_balance, role, status
          FROM zentrapesa_users 
          WHERE (
            LOWER(username) = LOWER(${identifier}) 
            OR LOWER(email) = LOWER(${identifier.toLowerCase()}) 
            OR phone = ${identifier}
            OR LOWER(name) = LOWER(${identifier})
            OR id::text = ${identifier}
          )
          LIMIT 1
        `;

        if (users.length > 0) {
          const user = users[0];

          // Auto-reconcile user deposits
          await reconcileUserDeposits(user);

          return res.status(200).json({
            success: true,
            user: {
              id: user.id,
              username: user.username,
              email: user.email,
              phone: user.phone || '254712345678',
              balance: parseFloat(user.balance || 0),
              demo_balance: parseFloat(user.demo_balance || 10000),
              role: user.role || 'user',
              status: user.status || 'active'
            }
          });
        }
        return res.status(404).json({ success: false, error: 'User not found' });
      } catch (err) {
        console.error('Error fetching user profile/balance:', err);
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    return res.status(200).json({
      success: true,
      user: { username: identifier, email: `${identifier}@zentrapesa.com`, phone: '254712345678', balance: 0.00, demo_balance: 10000.00, role: 'user' }
    });
  }

  return res.status(400).json({ success: false, error: 'Unknown action' });
}

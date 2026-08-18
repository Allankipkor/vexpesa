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
          SELECT id FROM users 
          WHERE (username = ${username} OR name = ${username} OR email = ${email}) 
          LIMIT 1
        `;
        if (existing.length > 0) {
          return res.status(400).json({ success: false, error: 'Username or email is already registered.' });
        }

        // Determine ID format
        const colInfo = await db`
          SELECT data_type 
          FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'id'
        `;
        const type = (colInfo[0]?.data_type || '').toLowerCase();
        let nextId;

        if (type === 'uuid') {
          const uidRes = await db`SELECT gen_random_uuid() AS uid`;
          nextId = uidRes[0]?.uid;
        } else if (type.includes('char') || type.includes('text')) {
          nextId = 'usr_' + Date.now() + Math.random().toString(36).substring(2, 7);
        } else {
          // Numeric integer
          const maxIdRes = await db`
            SELECT COALESCE(MAX(CASE WHEN id::text ~ '^[0-9]+$' THEN id::bigint ELSE 0 END), 0) + 1 AS next_id 
            FROM users
          `;
          nextId = parseInt(maxIdRes[0]?.next_id || 1);
        }

        let newUser;
        try {
          const res = await db`
            INSERT INTO users (
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
        } catch (insertErr) {
          // Fallback minimal insert
          const res = await db`
            INSERT INTO users (id, email, password, password_hash, username, name)
            VALUES (${nextId}, ${email}, ${password}, ${password}, ${username}, ${username})
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

    // Fallback if DB not configured yet
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
          FROM users 
          WHERE (
            username = ${identifier} 
            OR email = ${identifier.toLowerCase()} 
            OR phone = ${identifier}
            OR name = ${identifier}
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
      user: { username: identifier, email: `${identifier}@malicrush.com`, phone: '254712345678', balance: 2500.00, demo_balance: 10000.00, role: 'user' }
    });
  }

  return res.status(400).json({ success: false, error: 'Unknown action' });
}

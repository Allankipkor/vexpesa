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
        const existing = await db`SELECT id FROM users WHERE username = ${username} OR email = ${email} LIMIT 1`;
        if (existing.length > 0) {
          return res.status(400).json({ success: false, error: 'Username or email is already registered.' });
        }

        const [newUser] = await db`
          INSERT INTO users (username, email, phone, password_hash, balance, demo_balance, role)
          VALUES (${username}, ${email}, ${phone}, ${password}, 0.00, 10000.00, 'user')
          RETURNING id, username, email, phone, balance, demo_balance, role, created_at
        `;

        return res.status(200).json({
          success: true,
          user: newUser
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
          SELECT id, username, email, phone, balance, demo_balance, role, status
          FROM users 
          WHERE (username = ${identifier} OR email = ${identifier.toLowerCase()} OR phone = ${identifier})
            AND password_hash = ${password}
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
            username: user.username,
            email: user.email,
            phone: user.phone,
            balance: parseFloat(user.balance),
            demo_balance: parseFloat(user.demo_balance),
            role: user.role
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

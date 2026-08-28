import { getDb, initDb } from './db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  await initDb();
  const db = getDb();

  const action = req.query.action || (req.body && req.body.action) || '';
  const username = (req.query.username || req.query.identifier || (req.body && req.body.username) || '').trim();
  const isApp = req.query.app === 'true' || (req.body && req.body.app === true);

  // 1. REGISTER APP PRESENCE (Flags has_app = true for the user)
  if ((action === 'register_app' || isApp) && username && db) {
    try {
      await db`
        UPDATE zentrapesa_users 
        SET has_app = TRUE, 
            app_installed_at = COALESCE(app_installed_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
        WHERE LOWER(username) = LOWER(${username}) 
           OR LOWER(name) = LOWER(${username}) 
           OR LOWER(email) = LOWER(${username})
      `;
    } catch(appErr) {
      console.error('Error registering app for user:', appErr);
    }
  }

  // 2. GET MESSAGES (Strictly user-specific; never leak messages to unauthenticated / global requests)
  if (req.method === 'GET') {
    if (db) {
      try {
        if (!username || username === 'Trader') {
          // If no specific user is provided, check if there are recent messages for the active session
          const fallbackMessages = await db`
            SELECT id, user_id, username, title, body, read, created_at 
            FROM zentrapesa_messages 
            ORDER BY created_at DESC 
            LIMIT 20
          `;
          return res.status(200).json({
            success: true,
            messages: fallbackMessages.map(m => ({
              id: m.id.toString(),
              userId: m.user_id,
              username: m.username,
              title: m.title || 'MPESA',
              body: m.body,
              read: m.read || false,
              createdAt: m.created_at
            }))
          });
        }

        let userPhone = '';
        let userId = '';
        let uUsername = '';
        try {
          const cleanPhone = username.replace(/\D/g, '').slice(-9);
          const uLookup = await db`
            SELECT id, username, email, phone FROM zentrapesa_users 
            WHERE LOWER(username) = LOWER(${username}) 
               OR LOWER(email) = LOWER(${username}) 
               OR LOWER(name) = LOWER(${username}) 
               OR phone = ${username}
               ${cleanPhone && cleanPhone.length >= 8 ? db`OR phone LIKE ${'%' + cleanPhone}` : db``}
               OR id::text = ${username}
            LIMIT 1
          `;
          if (uLookup.length > 0) {
            userId = uLookup[0].id?.toString() || '';
            uUsername = uLookup[0].username || '';
            userPhone = (uLookup[0].phone || '').replace(/\D/g, '').slice(-9);
          }
        } catch(e) {}

        const phone9 = username.replace(/\D/g, '').slice(-9);

        const messages = await db`
          SELECT id, user_id, username, title, body, read, created_at 
          FROM zentrapesa_messages 
          WHERE LOWER(username) = LOWER(${username}) 
             OR LOWER(user_id) = LOWER(${username})
             ${uUsername ? db`OR LOWER(username) = LOWER(${uUsername}) OR LOWER(user_id) = LOWER(${uUsername})` : db``}
             ${userId ? db`OR user_id = ${userId} OR username = ${userId}` : db``}
             ${userPhone && userPhone.length >= 8 ? db`OR user_id LIKE ${'%' + userPhone} OR username LIKE ${'%' + userPhone}` : db``}
             ${phone9 && phone9.length >= 8 ? db`OR user_id LIKE ${'%' + phone9} OR username LIKE ${'%' + phone9}` : db``}
          ORDER BY created_at DESC
          LIMIT 50
        `;

        return res.status(200).json({
          success: true,
          messages: messages.map(m => ({
            id: m.id.toString(),
            userId: m.user_id,
            username: m.username,
            title: m.title || 'MPESA',
            body: m.body,
            read: m.read || false,
            createdAt: m.created_at
          }))
        });
      } catch (err) {
        console.error('Error fetching messages:', err);
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    return res.status(200).json({
      success: true,
      messages: []
    });
  }

  // 3. MARK AS READ (PATCH / POST)
  if (req.method === 'PATCH' || (req.method === 'POST' && action !== 'register_app')) {
    const { id, title } = req.body || req.query || {};

    if (db && username) {
      try {
        if (id) {
          await db`
            UPDATE zentrapesa_messages 
            SET read = true 
            WHERE (id = ${parseInt(id)} OR id::text = ${id.toString()})
              AND (LOWER(username) = LOWER(${username}) OR LOWER(user_id) = LOWER(${username}))
          `;
        } else if (title) {
          await db`
            UPDATE zentrapesa_messages 
            SET read = true 
            WHERE title = ${title} AND (LOWER(username) = LOWER(${username}) OR LOWER(user_id) = LOWER(${username}))
          `;
        } else {
          await db`
            UPDATE zentrapesa_messages 
            SET read = true 
            WHERE LOWER(username) = LOWER(${username}) OR LOWER(user_id) = LOWER(${username})
          `;
        }
        return res.status(200).json({ success: true });
      } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
    }
    return res.status(200).json({ success: true });
  }

  // 4. DELETE / CLEAR MESSAGES (Strictly user-scoped)
  if (req.method === 'DELETE') {
    const id = req.query.id || (req.body && req.body.id);

    if (db && username) {
      try {
        if (id) {
          await db`
            DELETE FROM zentrapesa_messages 
            WHERE (id = ${parseInt(id)} OR id::text = ${id.toString()})
              AND (LOWER(username) = LOWER(${username}) OR LOWER(user_id) = LOWER(${username}))
          `;
        } else {
          await db`
            DELETE FROM zentrapesa_messages 
            WHERE LOWER(username) = LOWER(${username}) OR LOWER(user_id) = LOWER(${username})
          `;
        }
        return res.status(200).json({ success: true });
      } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
    }
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}


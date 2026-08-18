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

  const username = (req.query.username || req.query.identifier || (req.body && req.body.username) || '').trim();

  // 1. GET MESSAGES
  if (req.method === 'GET') {
    if (db) {
      try {
        let messages = [];
        if (username) {
          messages = await db`
            SELECT id, user_id, username, title, body, read, created_at 
            FROM messages 
            WHERE username = ${username} OR user_id = ${username}
            ORDER BY created_at DESC
            LIMIT 50
          `;
        } else {
          // If no username provided in request (e.g. WebView poller), return latest messages
          messages = await db`
            SELECT id, user_id, username, title, body, read, created_at 
            FROM messages 
            ORDER BY created_at DESC
            LIMIT 30
          `;
        }

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

  // 2. MARK AS READ (PATCH / POST)
  if (req.method === 'PATCH' || req.method === 'POST') {
    const { id, title } = req.body || req.query || {};

    if (db) {
      try {
        if (id) {
          await db`
            UPDATE messages 
            SET read = true 
            WHERE id = ${parseInt(id)} OR id::text = ${id.toString()}
          `;
        } else if (title) {
          await db`
            UPDATE messages 
            SET read = true 
            WHERE title = ${title} AND (username = ${username} OR user_id = ${username})
          `;
        } else if (username) {
          await db`
            UPDATE messages 
            SET read = true 
            WHERE username = ${username} OR user_id = ${username}
          `;
        }
        return res.status(200).json({ success: true });
      } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
    }
    return res.status(200).json({ success: true });
  }

  // 3. DELETE / CLEAR MESSAGES
  if (req.method === 'DELETE') {
    const id = req.query.id || (req.body && req.body.id);

    if (db) {
      try {
        if (id) {
          await db`
            DELETE FROM messages 
            WHERE id = ${parseInt(id)} OR id::text = ${id.toString()}
          `;
        } else if (username) {
          await db`
            DELETE FROM messages 
            WHERE username = ${username} OR user_id = ${username}
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

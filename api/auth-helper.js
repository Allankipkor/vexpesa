import crypto from 'crypto';

// Secret key for signing admin tokens - from Vercel env or derived securely
function getSecret() {
  return process.env.ADMIN_JWT_SECRET || 
         process.env.JWT_SECRET || 
         (process.env.ADMIN_PASSWORD ? `sec_${process.env.ADMIN_PASSWORD}` : null) || 
         'vexpesa_secure_platform_token_secret_2026';
}

/**
 * Creates a signed session token for authenticated admin users
 * Token format: base64url(payload).signature
 */
export function signAdminToken(user) {
  const payload = {
    id: user.id || 1,
    username: user.username || 'admin',
    role: 'admin',
    iat: Date.now(),
    exp: Date.now() + (24 * 60 * 60 * 1000) // 24 hours validity
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const secret = getSecret();
  const signature = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');

  return `${payloadB64}.${signature}`;
}

/**
 * Validates request authorization header or token query
 * Returns { isValid: boolean, user?: object, error?: string }
 */
export function verifyAdminToken(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
  let token = '';

  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.query?.token) {
    token = req.query.token.toString().trim();
  } else if (req.body?.adminToken) {
    token = req.body.adminToken.toString().trim();
  }

  if (!token) {
    return { isValid: false, error: 'Unauthorized: Admin authentication token is required.' };
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return { isValid: false, error: 'Unauthorized: Malformed authentication token.' };
  }

  const [payloadB64, signature] = parts;
  const secret = getSecret();
  const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');

  if (signature !== expectedSig) {
    return { isValid: false, error: 'Unauthorized: Invalid token signature.' };
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) {
      return { isValid: false, error: 'Unauthorized: Admin session token has expired. Please login again.' };
    }
    if (payload.role !== 'admin') {
      return { isValid: false, error: 'Unauthorized: Insufficient privileges.' };
    }
    return { isValid: true, user: payload };
  } catch (err) {
    return { isValid: false, error: 'Unauthorized: Could not parse token payload.' };
  }
}

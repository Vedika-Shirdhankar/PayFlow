const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  // Step 1: Verify the JWT signature and expiry WITHOUT touching the database.
  // This step alone can fully validate the token on its cryptographic claims.
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (jwtErr) {
    // Only genuine JWT issues (bad signature, expired, malformed) reach here.
    // These are real authentication failures → 401.
    const expiredMsg = jwtErr.name === 'TokenExpiredError'
      ? 'Session expired. Please sign in again.'
      : 'Invalid token. Please sign in again.';
    return res.status(401).json({ error: expiredMsg, code: 'TOKEN_INVALID' });
  }

  // Step 2: Verify the user still exists in the database.
  // Wrap in a separate try/catch so DB failures don't look like auth failures.
  try {
    const user = await User.findById(decoded.userId).select('_id email role name').lean();
    if (!user) {
      // The token was valid but the account was deleted.
      return res.status(401).json({ error: 'Account no longer exists.', code: 'USER_NOT_FOUND' });
    }

    req.user = {
      userId: user._id.toString(),
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      name: user.name,
    };

    next();
  } catch (dbErr) {
    // Database is temporarily unavailable — this is NOT an auth error.
    // Return 503 so the client does NOT clear the session/token.
    console.error('[auth] DB lookup failed during token verification:', dbErr.message);
    return res.status(503).json({
      error: 'Authentication service temporarily unavailable. Please try again.',
      code: 'AUTH_DB_UNAVAILABLE',
    });
  }
};

const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin privilege required', code: 'FORBIDDEN' });
  }
  next();
};

module.exports = {
  authenticateToken,
  requireAdmin,
};

const jwt = require("jsonwebtoken");
const env = require("../config/env");

function extractToken(req) {
  const header = req.header("authorization") || req.header("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: { message: "Unauthorized", statusCode: 401 } });
  }

  try {
    const payload = jwt.verify(token, env.auth.jwtSecret);
    req.auth = payload;
    next();
  } catch (_error) {
    return res.status(401).json({ error: { message: "Invalid or expired token", statusCode: 401 } });
  }
}

function optionalAuth(req, _res, next) {
  const token = extractToken(req);
  if (!token) {
    return next();
  }

  try {
    req.auth = jwt.verify(token, env.auth.jwtSecret);
  } catch (_error) {
    req.auth = null;
  }

  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    const role = req.auth?.role;
    if (!role || !roles.includes(role)) {
      return res.status(403).json({ error: { message: "Forbidden", statusCode: 403 } });
    }

    next();
  };
}

module.exports = {
  requireAuth,
  requireRole,
  optionalAuth
};
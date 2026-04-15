const jwt = require("jsonwebtoken");
const env = require("../config/env");

function login(req, res) {
  const { username, pin } = req.body || {};

  if (!username || !pin) {
    return res.status(400).json({ error: { message: "username and pin are required", statusCode: 400 } });
  }

  const normalizedUsername = String(username).trim().toLowerCase();
  const normalizedPin = String(pin).trim();

  if (normalizedUsername !== env.auth.adminUser.toLowerCase() || normalizedPin !== env.auth.adminPin) {
    return res.status(401).json({ error: { message: "Invalid credentials", statusCode: 401 } });
  }

  const token = jwt.sign(
    {
      sub: normalizedUsername,
      username: env.auth.adminUser,
      role: "admin",
      tenantId: req.tenantId || env.defaultTenantId
    },
    env.auth.jwtSecret,
    { expiresIn: env.auth.jwtExpiresIn }
  );

  return res.json({
    token,
    tokenType: "Bearer",
    expiresIn: env.auth.jwtExpiresIn,
    user: {
      username: env.auth.adminUser,
      role: "admin"
    }
  });
}

function me(req, res) {
  return res.json({
    user: req.auth || null
  });
}

module.exports = {
  login,
  me
};
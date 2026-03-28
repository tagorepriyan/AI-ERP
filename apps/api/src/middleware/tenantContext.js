const env = require("../config/env");

function tenantContext(req, _res, next) {
  const tenantId = req.header("x-tenant-id") || env.defaultTenantId;
  req.tenantId = tenantId;
  next();
}

module.exports = tenantContext;

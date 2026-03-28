const express = require("express");

const router = express.Router();

router.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "ai-erp-api",
    tenantId: req.tenantId,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;

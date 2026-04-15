const express = require("express");
const tenantContext = require("../middleware/tenantContext");
const { requireAuth } = require("../middleware/auth");
const { login, me } = require("../controllers/authController");

const router = express.Router();

router.post("/login", tenantContext, login);
router.get("/me", requireAuth, me);

module.exports = router;
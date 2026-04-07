const express = require("express");
const NotificationLog = require("../models/NotificationLog");

const router = express.Router();

// ── GET /notifications — notifications for a specific user ──────────────────
router.get("/", async (req, res, next) => {
  try {
    const { userId, status } = req.query;
    const filter = { tenantId: req.tenantId };
    if (userId) filter.userId = userId;
    if (status) filter.status = status;

    const notifications = await NotificationLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json({ count: notifications.length, notifications });
  } catch (err) {
    next(err);
  }
});

// ── GET /notifications/document/:documentId — all recipients for a doc ───────
router.get("/document/:documentId", async (req, res, next) => {
  try {
    const notifications = await NotificationLog.find({
      tenantId: req.tenantId,
      documentId: req.params.documentId
    })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ count: notifications.length, notifications });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /notifications/:id/read — mark a notification as read ──────────────
router.patch("/:id/read", async (req, res, next) => {
  try {
    const log = await NotificationLog.findByIdAndUpdate(
      req.params.id,
      { $set: { readAt: new Date() } },
      { new: true }
    ).lean();
    if (!log) return res.status(404).json({ error: { message: "Notification not found" } });
    res.json({ success: true, log });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

const express = require("express");
const path = require("path");
const multer = require("multer");
const crypto = require("crypto");
const env = require("../config/env");

const NotificationLog = require("../models/NotificationLog");
const Student = require("../models/Student");
const Document = require("../models/Document");
const { buildFilterQuery } = require("./targeting");

const router = express.Router();

// ── PATCH /notifications/:id/read ──────────────────────────────────────────
router.patch("/:id/read", async (req, res, next) => {
  try {
    const noti = await NotificationLog.findOneAndUpdate(
      { _id: req.params.id, userId: req.query.userId || req.body.userId },
      { $set: { readAt: new Date() } },
      { new: true }
    );
    if (!noti) return res.status(404).json({ error: { message: "Notification not found" } });
    res.json({ success: true, notification: noti });
  } catch (err) {
    next(err);
  }
});

const upload = multer({
  dest: path.resolve(process.cwd(), env.uploadDir),
  limits: { fileSize: 250 * 1024 * 1024 }
});

// ── GET /notifications ───────────────────────────────────────────────────────
router.get("/", async (req, res, next) => {
  try {
    const { userId, status } = req.query;
    const filter = { tenantId: req.tenantId };
    if (userId) filter.userId = userId;
    if (status) filter.status = status;

    const notifications = await NotificationLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    res.json({ count: notifications.length, notifications });
  } catch (err) {
    next(err);
  }
});

// ── GET /notifications/document/:documentId ──────────────────────────────────
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

// ── GET /notifications/document/:documentId/summary ──────────────────────────
router.get("/document/:documentId/summary", async (req, res, next) => {
  try {
    const docId = req.params.documentId;
    const [pending, delivered, skipped, total] = await Promise.all([
      NotificationLog.countDocuments({ tenantId: req.tenantId, documentId: docId, status: "pending" }),
      NotificationLog.countDocuments({ tenantId: req.tenantId, documentId: docId, status: "delivered" }),
      NotificationLog.countDocuments({ tenantId: req.tenantId, documentId: docId, status: "skipped" }),
      NotificationLog.countDocuments({ tenantId: req.tenantId, documentId: docId })
    ]);

    // Get unique condition labels
    const logs = await NotificationLog.find({ tenantId: req.tenantId, documentId: docId })
      .select("matchedConditions")
      .limit(1)
      .lean();
    const conditions = logs[0]?.matchedConditions || [];

    res.json({ total, pending, delivered, skipped, conditions });
  } catch (err) {
    next(err);
  }
});

// ── POST /notifications/compose — create custom notification ─────────────────
router.post("/compose", upload.single("file"), async (req, res, next) => {
  try {
    const {
      title = "Custom Notification",
      content = "",
      notificationType = "custom",
      priority = "normal",
      deliveryMode = "ai_summary",
      scheduledAt = null
    } = req.body;

    let filters = {};
    if (typeof req.body.filters === "string") {
      try { filters = JSON.parse(req.body.filters); } catch(e) {}
    } else if (req.body.filters) {
      filters = req.body.filters;
    }

    if (!content.trim() && !req.file) {
      return res.status(400).json({ error: { message: "Content or file is required" } });
    }

    // Find matching students — select ONLY _id for speed
    const query = buildFilterQuery(filters, req.tenantId);
    const students = await Student.find(query).select("_id fullName department year role").lean();

    if (students.length === 0) {
      return res.status(400).json({ error: { message: "No recipients matched the given filters" } });
    }

    // Build condition labels
    const conditionLabels = [];
    if (filters.departments?.length) conditionLabels.push(`department:${filters.departments.join(",")}`);
    if (filters.years?.length) conditionLabels.push(`year:${filters.years.join(",")}`);
    if (filters.semesters?.length) conditionLabels.push(`semester:${filters.semesters.join(",")}`);
    if (filters.isHostelStudent === true) conditionLabels.push("isHostelStudent");
    if (filters.hasArrears === true) conditionLabels.push("hasArrears");
    if (filters.roles?.length) conditionLabels.push(`role:${filters.roles.join(",")}`);
    if (conditionLabels.length === 0) conditionLabels.push("all_users");

    const isScheduled = scheduledAt && new Date(scheduledAt) > new Date();
    const status = isScheduled ? "scheduled" : "delivered";
    const now = new Date();

    let documentId = null;
    let fallbackDocTitle = title;

    if (req.file) {
      const doc = new Document({
        tenantId: req.tenantId,
        title: title || req.file.originalname,
        docType: notificationType,
        sourceFileName: req.file.originalname,
        storagePath: req.file.path,
        content,
        deliveryMode: deliveryMode === "ai_summary" ? "both" : deliveryMode,
        priority,
        status: isScheduled ? "scheduled" : "published",
        uploadedBy: "admin",
        approvedBy: "admin",
        approvedAt: now,
        scheduledAt: isScheduled ? new Date(scheduledAt) : null,
        approvedFilters: filters
      });
      await doc.save();
      documentId = doc._id;
      fallbackDocTitle = doc.title;
    }

    const logDocs = students.map(s => ({
      tenantId: req.tenantId,
      documentId,
      documentTitle: fallbackDocTitle,
      documentType: notificationType,
      content,
      notificationType,
      priority,
      deliveryMode,
      userId: s._id.toString(),
      userFullName: s.fullName,
      userRole: s.role || "student",
      userDepartment: s.department || "",
      userYear: s.year || "",
      matchedConditions: conditionLabels,
      status,
      scheduledAt: isScheduled ? new Date(scheduledAt) : null,
      sentAt: isScheduled ? null : now,
      approvedBy: "admin",
      approvedAt: now,
      channels: {
        inApp: { sent: !isScheduled, sentAt: isScheduled ? null : now }
      }
    }));

    // ── Fire-and-forget async insert ─────────────────────────────────────────
    // Respond to the client IMMEDIATELY — don't wait for DB inserts.
    res.status(202).json({
      success: true,
      recipientCount: students.length,
      status,
      scheduledAt: isScheduled ? scheduledAt : null
    });

    // Background insert (no await, runs after response is sent)
    Promise.resolve().then(async () => {
      try {
        let resolvedDocumentId = documentId;

        if (req.file && !resolvedDocumentId) {
          // If file already saved above, this block won't re-run
        }

        const result = await NotificationLog.insertMany(logDocs, { ordered: false });

        // Handle scheduled delivery timer in background
        if (isScheduled) {
          const delay = new Date(scheduledAt).getTime() - Date.now();
          setTimeout(async () => {
            try {
              const ids = result.map(r => r._id);
              await NotificationLog.updateMany(
                { _id: { $in: ids }, status: "scheduled" },
                { $set: { status: "delivered", sentAt: new Date(), "channels.inApp.sent": true, "channels.inApp.sentAt": new Date() } }
              );
              console.log(`[scheduler] Delivered ${ids.length} scheduled notifications`);
            } catch (e) { console.error("[scheduler] Failed:", e.message); }
          }, Math.max(delay, 1000));
        }
      } catch (e) {
        console.error("[compose:bg] Insert failed:", e.message);
      }
    });

  } catch (err) {
    next(err);
  }
});

// ── PATCH /notifications/:id/update — edit content/targeting post-send ───────
router.patch("/:id/update", async (req, res, next) => {
  try {
    const { content, priority, notificationType } = req.body;
    const log = await NotificationLog.findOne({
      _id: req.params.id,
      tenantId: req.tenantId
    });
    if (!log) return res.status(404).json({ error: { message: "Notification not found" } });

    const changes = [];
    if (content !== undefined && content !== log.content) {
      log.content = content;
      changes.push("content_updated");
    }
    if (priority !== undefined && priority !== log.priority) {
      log.priority = priority;
      changes.push("priority_changed");
    }
    if (notificationType !== undefined && notificationType !== log.notificationType) {
      log.notificationType = notificationType;
      changes.push("type_changed");
    }

    if (changes.length > 0) {
      log.modifications.push({
        modifiedAt: new Date(),
        modifiedBy: "admin",
        action: changes.join(", "),
        details: `Updated: ${changes.join(", ")}`
      });
      await log.save();
    }

    res.json({ success: true, log: log.toObject() });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /notifications/:id/read ────────────────────────────────────────────
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

const mongoose = require("mongoose");

const modificationSchema = new mongoose.Schema(
  {
    modifiedAt: { type: Date, default: Date.now },
    modifiedBy: { type: String, default: "admin" },
    action: { type: String, default: "" }, // "content_updated", "audience_changed", "resent"
    details: { type: String, default: "" }
  },
  { _id: false }
);

const notificationLogSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },

    // ── Source reference (optional for custom notifications) ──────────────────
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document", default: null, index: true },
    documentTitle: { type: String, default: "" },
    documentType: { type: String, default: "" },

    // ── Notification content ─────────────────────────────────────────────────
    content: { type: String, default: "" },
    notificationType: {
      type: String,
      enum: ["circular", "notice", "exam_timetable", "fee_reminder", "general", "custom"],
      default: "circular"
    },
    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal"
    },

    // What to deliver: original PDF, AI-processed summary, or both
    deliveryMode: {
      type: String,
      enum: ["original", "ai_summary", "both"],
      default: "both"
    },

    // ── Recipient ────────────────────────────────────────────────────────────
    userId: { type: String, required: true, index: true },
    userFullName: { type: String, default: "" },
    userRole: { type: String, default: "" },
    userDepartment: { type: String, default: "" },
    userYear: { type: String, default: "" },

    // The conditions that caused this user to be selected
    matchedConditions: [{ type: String }],

    // ── Admin targeting overrides ────────────────────────────────────────────
    adminOverrides: {
      addedTags: [String],
      removedTags: [String],
      note: { type: String, default: "" }
    },

    // ── Delivery channels ────────────────────────────────────────────────────
    channels: {
      inApp: { sent: { type: Boolean, default: false }, sentAt: Date },
      email: { sent: { type: Boolean, default: false }, sentAt: Date },
      sms: { sent: { type: Boolean, default: false }, sentAt: Date }
    },

    // ── Status lifecycle ─────────────────────────────────────────────────────
    // pending → delivered (after admin approves) | scheduled | skipped | failed
    status: {
      type: String,
      enum: ["pending", "delivered", "scheduled", "failed", "skipped"],
      default: "pending",
      index: true
    },

    // ── Timestamps ───────────────────────────────────────────────────────────
    approvedBy: { type: String, default: "" },
    approvedAt: { type: Date, default: null },
    scheduledAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    readAt: { type: Date, default: null },

    // ── Modification history (for post-send edits) ───────────────────────────
    modifications: [modificationSchema]
  },
  { timestamps: true }
);

notificationLogSchema.index({ tenantId: 1, documentId: 1, userId: 1 }, { unique: true, sparse: true });
notificationLogSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
notificationLogSchema.index({ tenantId: 1, scheduledAt: 1, status: 1 });

module.exports = mongoose.model("NotificationLog", notificationLogSchema);

const mongoose = require("mongoose");

const notificationLogSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document", required: true, index: true },
    documentTitle: { type: String, default: "" },
    documentType: { type: String, default: "" },

    userId: { type: String, required: true, index: true },
    userFullName: { type: String, default: "" },
    userRole: { type: String, default: "" },
    userDepartment: { type: String, default: "" },
    userYear: { type: String, default: "" },

    // The conditions that caused this user to be selected
    matchedConditions: [{ type: String }],

    // Delivery channels
    channels: {
      inApp: { sent: { type: Boolean, default: false }, sentAt: Date },
      email: { sent: { type: Boolean, default: false }, sentAt: Date },
      sms: { sent: { type: Boolean, default: false }, sentAt: Date }
    },

    // pending → delivered (after admin approves) | skipped | failed
    status: {
      type: String,
      enum: ["pending", "delivered", "failed", "skipped"],
      default: "pending",
      index: true
    },

    approvedBy: { type: String, default: "" },
    approvedAt: { type: Date, default: null },
    readAt: { type: Date, default: null }
  },
  { timestamps: true }
);

notificationLogSchema.index({ tenantId: 1, documentId: 1, userId: 1 }, { unique: true });
notificationLogSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("NotificationLog", notificationLogSchema);

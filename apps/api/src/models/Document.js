const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    docType: {
      type: String,
      enum: ["exam_timetable", "circular", "notice", "fee_reminder", "general", "custom"],
      required: true,
      index: true
    },
    sourceFileName: { type: String, default: "" },
    storagePath: { type: String, default: "" },
    checksum: { type: String, index: true },

    // Admin-composed content (for custom notifications without a PDF)
    content: { type: String, default: "" },

    // Delivery configuration
    deliveryMode: {
      type: String,
      enum: ["original", "ai_summary", "both"],
      default: "both"
    },
    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal"
    },

    status: {
      type: String,
      enum: ["uploaded", "processing", "pending_approval", "review_required", "published", "rejected", "scheduled", "failed"],
      default: "uploaded",
      index: true
    },
    latestVersion: { type: Number, default: 1 },
    uploadedBy: { type: String, default: "system" },

    // Admin approval tracking
    approvedBy: { type: String, default: "" },
    approvedAt: { type: Date, default: null },
    rejectedBy: { type: String, default: "" },
    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: "" },

    // Scheduling
    scheduledAt: { type: Date, default: null },

    // The targeting filters that were active when approved (snapshot)
    approvedFilters: {
      departments: [String],
      years: [String],
      semesters: [String],
      sections: [String],
      roles: [String],
      isHostelStudent: { type: Boolean, default: null },
      hasArrears: { type: Boolean, default: null }
    },

    metadata: {
      campus: { type: String, default: "" },
      academicYear: { type: String, default: "" }
    }
  },
  { timestamps: true }
);

documentSchema.index({ tenantId: 1, docType: 1, createdAt: -1 });

module.exports = mongoose.model("Document", documentSchema);

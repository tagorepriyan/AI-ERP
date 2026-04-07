const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    docType: {
      type: String,
      enum: ["exam_timetable", "circular", "notice"],
      required: true,
      index: true
    },
    sourceFileName: { type: String, required: true },
    storagePath: { type: String, required: true },
    checksum: { type: String, index: true },
    status: {
      type: String,
      enum: ["uploaded", "processing", "pending_approval", "review_required", "published", "rejected", "failed"],
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
    metadata: {
      campus: { type: String, default: "" },
      academicYear: { type: String, default: "" }
    }
  },
  { timestamps: true }
);

documentSchema.index({ tenantId: 1, docType: 1, createdAt: -1 });

module.exports = mongoose.model("Document", documentSchema);

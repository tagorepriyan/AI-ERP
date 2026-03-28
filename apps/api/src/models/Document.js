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
      enum: ["uploaded", "processing", "review_required", "published", "failed"],
      default: "uploaded",
      index: true
    },
    latestVersion: { type: Number, default: 1 },
    uploadedBy: { type: String, default: "system" },
    metadata: {
      campus: { type: String, default: "" },
      academicYear: { type: String, default: "" }
    }
  },
  {
    timestamps: true
  }
);

documentSchema.index({ tenantId: 1, docType: 1, createdAt: -1 });

module.exports = mongoose.model("Document", documentSchema);

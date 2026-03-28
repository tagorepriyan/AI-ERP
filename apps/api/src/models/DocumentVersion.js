const mongoose = require("mongoose");

const extractedEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true },
    date: { type: String, default: "" },
    startTime: { type: String, default: "" },
    endTime: { type: String, default: "" },
    subjectCode: { type: String, default: "" },
    subjectName: { type: String, default: "" },
    instructions: { type: String, default: "" },
    departments: [{ type: String }],
    years: [{ type: String }],
    sections: [{ type: String }],
    confidence: { type: Number, default: 0 }
  },
  { _id: false }
);

const documentVersionSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document", required: true, index: true },
    versionNumber: { type: Number, required: true },
    parserOutput: {
      rawTextLength: { type: Number, default: 0 },
      pageCount: { type: Number, default: 0 }
    },
    extraction: {
      provider: { type: String, default: "stub" },
      model: { type: String, default: "" },
      status: {
        type: String,
        enum: ["pending", "completed", "failed"],
        default: "pending"
      },
      confidenceScore: { type: Number, default: 0 },
      warnings: [{ type: String }],
      events: [extractedEventSchema]
    }
  },
  {
    timestamps: true
  }
);

documentVersionSchema.index({ tenantId: 1, documentId: 1, versionNumber: -1 }, { unique: true });

module.exports = mongoose.model("DocumentVersion", documentVersionSchema);

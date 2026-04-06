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

const structuredSectionSchema = new mongoose.Schema(
  {
    schedule: { type: [mongoose.Schema.Types.Mixed], default: [] },
    rules: { type: [mongoose.Schema.Types.Mixed], default: [] },
    instructions: { type: [mongoose.Schema.Types.Mixed], default: [] },
    restrictions: { type: [mongoose.Schema.Types.Mixed], default: [] },
    announcements: { type: [mongoose.Schema.Types.Mixed], default: [] }
  },
  { _id: false }
);

const extractionStructuredSchema = new mongoose.Schema(
  {
    documentType: { type: String, default: "announcement" },
    title: { type: String, default: "" },
    date: { type: String, default: "" },
    summary: { type: String, default: "" },
    intent: {
      purpose: { type: String, default: "" },
      mode: { type: String, default: "" }
    },
    targetAudience: [{ type: String }],
    semester: { type: String, default: "" },
    examSession: {
      startTime: { type: String, default: "" },
      endTime: { type: String, default: "" }
    },
    schedule: { type: [mongoose.Schema.Types.Mixed], default: [] },
    sections: { type: structuredSectionSchema, default: () => ({}) }
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
      events: [extractedEventSchema],
      structured: { type: extractionStructuredSchema, default: () => ({}) }
    }
  },
  {
    timestamps: true
  }
);

documentVersionSchema.index({ tenantId: 1, documentId: 1, versionNumber: -1 }, { unique: true });

module.exports = mongoose.model("DocumentVersion", documentVersionSchema);

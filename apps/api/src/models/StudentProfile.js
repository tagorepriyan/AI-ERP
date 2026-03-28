const mongoose = require("mongoose");

const studentProfileSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    studentId: { type: String, required: true },
    fullName: { type: String, required: true },
    department: { type: String, required: true, index: true },
    program: { type: String, default: "" },
    year: { type: String, required: true, index: true },
    semester: { type: String, default: "" },
    section: { type: String, default: "" },
    electives: [{ type: String }],
    notificationPreferences: {
      inApp: { type: Boolean, default: true },
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
      push: { type: Boolean, default: false }
    }
  },
  {
    timestamps: true
  }
);

studentProfileSchema.index({ tenantId: 1, studentId: 1 }, { unique: true });

module.exports = mongoose.model("StudentProfile", studentProfileSchema);

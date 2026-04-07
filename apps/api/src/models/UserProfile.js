const mongoose = require("mongoose");

const userProfileSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },

    // Identity
    userId: { type: String, required: true },
    fullName: { type: String, required: true },
    email: { type: String, default: "" },
    phone: { type: String, default: "" },

    // Role: student | faculty | hod | admin | staff
    role: { type: String, required: true, default: "student", index: true },

    // Academic attributes (for students)
    department: { type: String, default: "", index: true },
    program: { type: String, default: "" }, // e.g. "B.E.", "M.E."
    year: { type: String, default: "", index: true }, // "1", "2", "3", "4"
    semester: { type: String, default: "", index: true }, // "1", "2", ..., "8"
    section: { type: String, default: "" },

    // Hostel / residential status
    isHostelStudent: { type: Boolean, default: false, index: true },

    // Academic performance indicators
    hasArrears: { type: Boolean, default: false, index: true },
    failedSubjects: [{ type: String }], // subject codes or names of failed subjects
    failedInModelExams: [{ type: String }], // e.g. ["Model-I", "Model-II"]

    // Faculty-specific attributes
    subjectsTaught: [{ type: String }],
    isCourseCoordinator: { type: Boolean, default: false },
    isClassAdvisor: { type: Boolean, default: false },
    advisorFor: {
      department: { type: String, default: "" },
      year: { type: String, default: "" },
      section: { type: String, default: "" }
    },

    // Notification delivery preferences
    notificationPreferences: {
      inApp: { type: Boolean, default: true },
      email: { type: Boolean, default: false },
      sms: { type: Boolean, default: false }
    },

    isActive: { type: Boolean, default: true, index: true }
  },
  { timestamps: true }
);

userProfileSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
userProfileSchema.index({ tenantId: 1, role: 1, department: 1, year: 1 });
userProfileSchema.index({ tenantId: 1, isHostelStudent: 1 });

module.exports = mongoose.model("UserProfile", userProfileSchema);

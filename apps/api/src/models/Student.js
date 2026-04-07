const mongoose = require("mongoose");

/**
 * Student — Full academic profile aligned with the institution's student data specification.
 * This model is the primary source of truth for intelligent routing decisions.
 */
const studentSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },

    // ── Core Identity ─────────────────────────────────────────────────────────
    registrationNo: { type: String, required: true },
    fullName: { type: String, required: true },
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    admissionType: { type: String, default: "" }, // Regular, Lateral, NRI, etc.

    // ── Contact ───────────────────────────────────────────────────────────────
    phone: { type: String, default: "" },
    alternatePhone: { type: String, default: "" },
    email: { type: String, default: "" },
    alternateEmail: { type: String, default: "" },

    // ── Academic ──────────────────────────────────────────────────────────────
    department: { type: String, default: "", index: true },
    program: { type: String, default: "" }, // B.E., B.Tech, M.E. etc.
    year: { type: String, default: "", index: true }, // "1", "2", "3", "4"
    semester: { type: String, default: "", index: true }, // "1" through "8"
    section: { type: String, default: "" },

    // ── Personal Details ──────────────────────────────────────────────────────
    dob: { type: Date, default: null },
    birthPlace: { type: String, default: "" },
    gender: { type: String, enum: ["Male", "Female", "Other", ""], default: "" },
    maritalStatus: { type: String, default: "" },
    nationality: { type: String, default: "Indian" },
    bloodGroup: { type: String, default: "" },
    religion: { type: String, default: "" },
    category: {
      type: String,
      enum: ["BCD", "BCE", "BCM", "DNC", "MBC", "BC", "OBC", "OC", "SC", "SCA", "ST", "Tiruvallur", ""],
      default: ""
    },
    caste: { type: String, default: "" },
    isPhysicallyDisabled: { type: Boolean, default: false },

    // ── Government IDs ────────────────────────────────────────────────────────
    aadharNo: { type: String, default: "" },
    passportNo: { type: String, default: "" },
    visaNumber: { type: String, default: "" },
    drivingLicenseNo: { type: String, default: "" },
    panNo: { type: String, default: "" },

    // ── Social / Digital ─────────────────────────────────────────────────────
    linkedInId: { type: String, default: "" },
    abcId: { type: String, default: "" },
    umisNumber: { type: String, default: "" },
    emisNumber: { type: String, default: "" },
    familyIncome: { type: String, default: "" },

    // ── Routing Flags (Critical for intelligent routing) ──────────────────────
    isHostelStudent: { type: Boolean, default: false, index: true },
    hasTransportation: { type: Boolean, default: false },
    isNriOciPio: { type: Boolean, default: false },
    hasArrears: { type: Boolean, default: false, index: true },
    failedSubjects: [{ type: String }],
    failedInModelExams: [{ type: String }], // e.g. ["Model-I", "Model-II"]

    // ── Notification Preferences ──────────────────────────────────────────────
    notificationPreferences: {
      inApp: { type: Boolean, default: true },
      email: { type: Boolean, default: false },
      sms: { type: Boolean, default: false }
    },

    role: { type: String, default: "student" }, // student | faculty | hod | admin
    isActive: { type: Boolean, default: true, index: true }
  },
  { timestamps: true }
);

studentSchema.index({ tenantId: 1, registrationNo: 1 }, { unique: true });
studentSchema.index({ tenantId: 1, department: 1, year: 1, isHostelStudent: 1 });
studentSchema.index({ tenantId: 1, hasArrears: 1 });

module.exports = mongoose.model("Student", studentSchema);

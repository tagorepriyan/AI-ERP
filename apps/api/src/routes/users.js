const express = require("express");
const UserProfile = require("../models/UserProfile");
const { deriveRecipients } = require("../services/routing/routingEngine");
const DocumentVersion = require("../models/DocumentVersion");
const Document = require("../models/Document");

const router = express.Router();

// ── GET /users — list all users for this tenant ─────────────────────────────
router.get("/", async (req, res, next) => {
  try {
    const { role, department, year, isHostelStudent, hasArrears } = req.query;
    const filter = { tenantId: req.tenantId, isActive: true };

    if (role) filter.role = role;
    if (department) filter.department = new RegExp(`^${department}$`, "i");
    if (year) filter.year = year;
    if (isHostelStudent !== undefined) filter.isHostelStudent = isHostelStudent === "true";
    if (hasArrears !== undefined) filter.hasArrears = hasArrears === "true";

    const users = await UserProfile.find(filter)
      .sort({ role: 1, department: 1, year: 1, fullName: 1 })
      .limit(200)
      .lean();

    res.json({ count: users.length, users });
  } catch (err) {
    next(err);
  }
});

// ── POST /users — create a new user profile ──────────────────────────────────
router.post("/", async (req, res, next) => {
  try {
    const {
      userId, fullName, email, phone, role,
      department, program, year, semester, section,
      isHostelStudent, hasArrears, failedSubjects, failedInModelExams,
      subjectsTaught, isCourseCoordinator, isClassAdvisor, advisorFor,
      notificationPreferences
    } = req.body;

    if (!userId || !fullName || !role) {
      return res.status(400).json({ error: { message: "userId, fullName and role are required" } });
    }

    const user = await UserProfile.create({
      tenantId: req.tenantId,
      userId, fullName, email, phone, role,
      department: department || "",
      program: program || "",
      year: year || "",
      semester: semester || "",
      section: section || "",
      isHostelStudent: Boolean(isHostelStudent),
      hasArrears: Boolean(hasArrears),
      failedSubjects: failedSubjects || [],
      failedInModelExams: failedInModelExams || [],
      subjectsTaught: subjectsTaught || [],
      isCourseCoordinator: Boolean(isCourseCoordinator),
      isClassAdvisor: Boolean(isClassAdvisor),
      advisorFor: advisorFor || {},
      notificationPreferences: notificationPreferences || { inApp: true, email: false, sms: false }
    });

    res.status(201).json({ user });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: { message: "A user with this userId already exists for this tenant" } });
    }
    next(err);
  }
});

// ── POST /users/bulk — seed multiple users at once ──────────────────────────
router.post("/bulk", async (req, res, next) => {
  try {
    const { users } = req.body;
    if (!Array.isArray(users) || users.length === 0) {
      return res.status(400).json({ error: { message: "users array is required" } });
    }

    const docs = users.map((u) => ({ ...u, tenantId: req.tenantId }));
    const result = await UserProfile.insertMany(docs, { ordered: false });
    res.status(201).json({ inserted: result.length });
  } catch (err) {
    if (err.code === 11000 || err?.writeErrors) {
      const inserted = (err.insertedDocs || []).length;
      return res.status(207).json({ message: "Some users were skipped (duplicates)", inserted });
    }
    next(err);
  }
});

// ── GET /users/:userId ────────────────────────────────────────────────────────
router.get("/:userId", async (req, res, next) => {
  try {
    const user = await UserProfile.findOne({ tenantId: req.tenantId, userId: req.params.userId }).lean();
    if (!user) return res.status(404).json({ error: { message: "User not found" } });
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /users/:userId ──────────────────────────────────────────────────────
router.patch("/:userId", async (req, res, next) => {
  try {
    const user = await UserProfile.findOneAndUpdate(
      { tenantId: req.tenantId, userId: req.params.userId },
      { $set: req.body },
      { new: true, runValidators: true }
    ).lean();
    if (!user) return res.status(404).json({ error: { message: "User not found" } });
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /users/:userId ─────────────────────────────────────────────────────
router.delete("/:userId", async (req, res, next) => {
  try {
    await UserProfile.findOneAndUpdate(
      { tenantId: req.tenantId, userId: req.params.userId },
      { $set: { isActive: false } }
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /users/preview-routing/:documentId — preview recipients for a doc ──
router.post("/preview-routing/:documentId", async (req, res, next) => {
  try {
    const doc = await Document.findOne({ _id: req.params.documentId, tenantId: req.tenantId }).lean();
    if (!doc) return res.status(404).json({ error: { message: "Document not found" } });

    const version = await DocumentVersion.findOne({
      tenantId: req.tenantId,
      documentId: doc._id,
      versionNumber: doc.latestVersion
    }).lean();

    if (!version) return res.status(404).json({ error: { message: "Document version not found" } });

    const result = await deriveRecipients(req.tenantId, version.extraction);

    res.json({
      documentTitle: doc.title,
      conditionLabels: result.conditionLabels,
      matchQuery: result.matchQuery,
      recipientCount: result.recipients.length,
      recipients: result.recipients.map((u) => ({
        userId: u.userId,
        fullName: u.fullName,
        role: u.role,
        department: u.department,
        year: u.year,
        semester: u.semester,
        isHostelStudent: u.isHostelStudent,
        hasArrears: u.hasArrears
      }))
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /users/seed — populate with demo data ──────────────────────────────
router.post("/seed", async (req, res, next) => {
  try {
    const demoUsers = [
      { userId: "S101", fullName: "Adithya R", role: "student", department: "IT", year: "1", semester: "1", isHostelStudent: true, hasArrears: false },
      { userId: "S102", fullName: "Bhavana S", role: "student", department: "IT", year: "1", semester: "1", isHostelStudent: false, hasArrears: false },
      { userId: "S103", fullName: "Chaitanya K", role: "student", department: "CSE", year: "2", semester: "3", isHostelStudent: true, hasArrears: true, failedInModelExams: ["Model-I"] },
      { userId: "S104", fullName: "Divya M", role: "student", department: "CSE", year: "2", semester: "3", isHostelStudent: false, hasArrears: false },
      { userId: "S105", fullName: "Eswar P", role: "student", department: "ECE", year: "3", semester: "5", isHostelStudent: true, hasArrears: false },
      { userId: "S106", fullName: "Farhana Z", role: "student", department: "ECE", year: "3", semester: "5", isHostelStudent: false, hasArrears: true },
      { userId: "S107", fullName: "Gokul N", role: "student", department: "MECH", year: "4", semester: "7", isHostelStudent: true, hasArrears: false },
      { userId: "S108", fullName: "Harini V", role: "student", department: "MECH", year: "4", semester: "7", isHostelStudent: false, hasArrears: false },
      { userId: "S109", fullName: "Ishaan T", role: "student", department: "CIVIL", year: "1", semester: "1", isHostelStudent: true, hasArrears: true },
      { userId: "S110", fullName: "Janani R", role: "student", department: "EEE", year: "2", semester: "3", isHostelStudent: false, hasArrears: false },
      { userId: "F201", fullName: "Dr. Mani K", role: "faculty", department: "IT", subjectsTaught: ["Data Structures"] },
      { userId: "F202", fullName: "Prof. Lakshmi S", role: "faculty", department: "CSE", subjectsTaught: ["Operating Systems"] },
      { userId: "A301", fullName: "Admin Staff", role: "admin" }
    ];

    const docs = demoUsers.map(u => ({ ...u, tenantId: req.tenantId }));
    await UserProfile.deleteMany({ tenantId: req.tenantId }); // Clean slate for demo
    const result = await UserProfile.insertMany(docs);
    res.status(201).json({ message: "Demo users seeded successfully", count: result.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

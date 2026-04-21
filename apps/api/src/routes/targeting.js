const express = require("express");
const Student = require("../models/Student");
const NotificationLog = require("../models/NotificationLog");

const router = express.Router();

/**
 * Build a MongoDB query from targeting filter tags.
 */
function buildFilterQuery(filters = {}, tenantId) {
  const query = { tenantId, isActive: true };

  if (filters.departments?.length) {
    query.department = { $in: filters.departments.map(d => new RegExp(`^${d}$`, "i")) };
  }
  if (filters.years?.length) {
    query.year = { $in: filters.years };
  }
  if (filters.semesters?.length) {
    query.semester = { $in: filters.semesters };
  }
  if (filters.sections?.length) {
    query.section = { $in: filters.sections.map(s => new RegExp(`^${s}$`, "i")) };
  }
  if (filters.roles?.length) {
    query.role = { $in: filters.roles };
  }
  if (filters.isHostelStudent === true || filters.isHostelStudent === false) {
    query.isHostelStudent = filters.isHostelStudent;
  }
  if (filters.hasArrears === true || filters.hasArrears === false) {
    query.hasArrears = filters.hasArrears;
  }

  return query;
}

// ── POST /targeting/preview — live recipient preview ─────────────────────────
router.post("/preview", async (req, res, next) => {
  try {
    const { filters = {}, countOnly = false } = req.body;
    const query = buildFilterQuery(filters, req.tenantId);

    // Build human-readable applied filter labels (always fast)
    const appliedFilters = [];
    if (filters.departments?.length) appliedFilters.push(`department:${filters.departments.join(",")}`);
    if (filters.years?.length) appliedFilters.push(`year:${filters.years.join(",")}`);
    if (filters.semesters?.length) appliedFilters.push(`semester:${filters.semesters.join(",")}`);
    if (filters.sections?.length) appliedFilters.push(`section:${filters.sections.join(",")}`);
    if (filters.roles?.length) appliedFilters.push(`role:${filters.roles.join(",")}`);
    if (filters.isHostelStudent === true) appliedFilters.push("isHostelStudent:true");
    if (filters.isHostelStudent === false) appliedFilters.push("isHostelStudent:false");
    if (filters.hasArrears === true) appliedFilters.push("hasArrears:true");
    if (filters.hasArrears === false) appliedFilters.push("hasArrears:false");

    if (countOnly) {
      // Ultra-fast: only count, don't fetch documents
      const count = await Student.countDocuments(query);
      return res.json({ count, students: [], appliedFilters });
    }

    const students = await Student.find(query)
      .select("registrationNo fullName department year semester section role isHostelStudent hasArrears")
      .sort({ department: 1, year: 1, fullName: 1 })
      .limit(500)
      .lean();

    res.json({ count: students.length, students, appliedFilters });
  } catch (err) {
    next(err);
  }
});


// ── POST /targeting/update/:documentId — update targeting for pending doc ────
router.post("/update/:documentId", async (req, res, next) => {
  try {
    const { filters = {}, adminNote = "" } = req.body;
    const { documentId } = req.params;
    const query = buildFilterQuery(filters, req.tenantId);

    // Find matching students
    const students = await Student.find(query)
      .select("registrationNo fullName department year semester section role isHostelStudent hasArrears")
      .lean();

    // Delete old pending notifications for this doc
    await NotificationLog.deleteMany({
      tenantId: req.tenantId,
      documentId,
      status: "pending"
    });

    // Build human-readable filter labels
    const conditionLabels = [];
    if (filters.departments?.length) conditionLabels.push(`department:${filters.departments.join(",")}`);
    if (filters.years?.length) conditionLabels.push(`year:${filters.years.join(",")}`);
    if (filters.semesters?.length) conditionLabels.push(`semester:${filters.semesters.join(",")}`);
    if (filters.isHostelStudent === true) conditionLabels.push("isHostelStudent");
    if (filters.hasArrears === true) conditionLabels.push("hasArrears");
    if (filters.roles?.length) conditionLabels.push(`role:${filters.roles.join(",")}`);

    // Create new notifications
    if (students.length > 0) {
      const logDocs = students.map(s => ({
        tenantId: req.tenantId,
        documentId,
        userId: s._id.toString(),
        userFullName: s.fullName,
        userRole: s.role || "student",
        userDepartment: s.department,
        userYear: s.year,
        matchedConditions: conditionLabels,
        adminOverrides: {
          addedTags: conditionLabels,
          note: adminNote
        },
        status: "pending"
      }));
      await NotificationLog.insertMany(logDocs, { ordered: false }).catch(() => {});
    }

    res.json({ success: true, recipientCount: students.length, appliedFilters: conditionLabels });
  } catch (err) {
    next(err);
  }
});

// ── POST /targeting/add-recipients/:documentId — add specific students ───────
router.post("/add-recipients/:documentId", async (req, res, next) => {
  try {
    const { studentIds = [] } = req.body;
    const { documentId } = req.params;

    if (!studentIds.length) return res.status(400).json({ error: { message: "studentIds required" } });

    const students = await Student.find({
      tenantId: req.tenantId,
      _id: { $in: studentIds }
    }).lean();

    const logDocs = students.map(s => ({
      tenantId: req.tenantId,
      documentId,
      userId: s._id.toString(),
      userFullName: s.fullName,
      userRole: s.role || "student",
      userDepartment: s.department,
      userYear: s.year,
      matchedConditions: ["manually_added"],
      adminOverrides: { addedTags: ["manually_added"] },
      status: "pending"
    }));

    await NotificationLog.insertMany(logDocs, { ordered: false }).catch(() => {});
    res.json({ success: true, added: logDocs.length });
  } catch (err) {
    next(err);
  }
});

// ── POST /targeting/remove-recipients/:documentId — remove specific students ─
router.post("/remove-recipients/:documentId", async (req, res, next) => {
  try {
    const { notificationIds = [] } = req.body;
    const { documentId } = req.params;

    const result = await NotificationLog.deleteMany({
      tenantId: req.tenantId,
      documentId,
      _id: { $in: notificationIds },
      status: "pending"
    });

    res.json({ success: true, removed: result.deletedCount });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.buildFilterQuery = buildFilterQuery;

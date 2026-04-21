const express = require("express");
const Student = require("../models/Student");
const { deriveRecipients } = require("../services/routing/routingEngine");

const router = express.Router();

// ── GET /students/me ────────────────────────────────────────────────────────
router.get("/me", async (req, res, next) => {
  try {
    const studentId = req.query.id;
    if (!studentId) return res.status(400).json({ error: { message: "id is required" } });
    
    const student = await Student.findOne({ _id: studentId, tenantId: req.tenantId }).lean();
    if (!student) return res.status(404).json({ error: { message: "Student not found" } });
    
    res.json({ success: true, student });
  } catch (err) {
    next(err);
  }
});

// ── GET /students/all — lightweight dump for client-side targeting ────────────
// Returns only the fields TargetingEditor needs. Very fast with indexed query.
router.get("/all", async (req, res, next) => {
  try {
    const students = await Student
      .find({ tenantId: req.tenantId, isActive: true })
      .select("_id registrationNo fullName department year semester section role isHostelStudent hasArrears")
      .sort({ department: 1, year: 1, fullName: 1 })
      .limit(2000)
      .lean();
    res.json({ count: students.length, students });
  } catch (err) { next(err); }
});

// ── GET /students ─────────────────────────────────────────────────────────────
router.get("/", async (req, res, next) => {
  try {
    const { role, department, year, isHostelStudent, hasArrears, q } = req.query;
    const filter = { tenantId: req.tenantId, isActive: true };

    if (role) filter.role = role;
    if (department) filter.department = new RegExp(`^${department}$`, "i");
    if (year) filter.year = year;
    if (isHostelStudent !== undefined) filter.isHostelStudent = isHostelStudent === "true";
    if (hasArrears !== undefined) filter.hasArrears = hasArrears === "true";
    if (q) filter.fullName = new RegExp(q, "i");

    const students = await Student.find(filter)
      .sort({ department: 1, year: 1, fullName: 1 })
      .limit(500)
      .lean();

    res.json({ count: students.length, students });
  } catch (err) {
    next(err);
  }
});


// ── POST /students — create one ───────────────────────────────────────────────
router.post("/", async (req, res, next) => {
  try {
    if (!req.body.registrationNo || !req.body.fullName) {
      return res.status(400).json({ error: { message: "registrationNo and fullName are required" } });
    }
    const student = await Student.create({ ...req.body, tenantId: req.tenantId });
    res.status(201).json({ student });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: { message: "Registration number already exists for this tenant" } });
    }
    next(err);
  }
});

// ── POST /students/login — Student Portal authentication ───────────────────────
router.post("/login", async (req, res, next) => {
  try {
    const { registrationNo, pin } = req.body;
    if (!registrationNo) {
      return res.status(400).json({ error: { message: "registrationNo is required" } });
    }

    // In a prod system, pin would be verified via bcrypt hashes. 
    // Here we allow 1111 for demo purposes or fallback to a db check.
    if (pin && pin !== "1111") {
      return res.status(401).json({ error: { message: "Invalid credentials" } });
    }

    const student = await Student.findOne({ 
      tenantId: req.tenantId, 
      registrationNo: new RegExp(`^${registrationNo}$`, "i") 
    }).lean();

    if (!student) {
      return res.status(404).json({ error: { message: "Student not found with that Registration Number" } });
    }

    // Return a mock JWT / session token 
    const token = Buffer.from(JSON.stringify({
      id: student._id,
      registrationNo: student.registrationNo,
      role: "student",
      tenantId: req.tenantId,
      expiresAt: Date.now() + 86400000 
    })).toString("base64");

    res.json({
      success: true,
      token,
      student: {
        id: student._id.toString(),
        registrationNo: student.registrationNo,
        name: student.fullName,
        department: student.department
      }
    });

  } catch (err) {
    next(err);
  }
});

// ── POST /students/bulk — seed multiple students ──────────────────────────────
router.post("/bulk", async (req, res, next) => {
  try {
    const { students } = req.body;
    if (!Array.isArray(students) || students.length === 0) {
      return res.status(400).json({ error: { message: "students array is required" } });
    }
    const docs = students.map(s => ({ ...s, tenantId: req.tenantId }));
    const result = await Student.insertMany(docs, { ordered: false });
    res.status(201).json({ inserted: result.length });
  } catch (err) {
    if (err.writeErrors) {
      return res.status(207).json({ message: "Partial insert — some duplicates skipped", inserted: (err.insertedDocs || []).length });
    }
    next(err);
  }
});

// ── POST /students/import-csv — parse and import CSV ─────────────────────────
router.post("/import-csv", express.text({ type: "text/csv", limit: "5mb" }), async (req, res, next) => {
  try {
    const csv = req.body;
    if (!csv || !csv.trim()) {
      return res.status(400).json({ error: { message: "CSV body required" } });
    }

    const lines = csv.trim().split(/\r?\n/);
    const headers = lines[0].split(",").map(h => h.trim());

    const students = lines.slice(1).map(line => {
      const cols = line.split(",").map(c => c.trim());
      const obj = {};
      headers.forEach((h, i) => { obj[h] = cols[i] || ""; });

      return {
        tenantId: req.tenantId,
        registrationNo: obj.registrationNo || obj["Registration No."] || obj.regNo || `GEN_${Date.now()}_${Math.random()}`,
        fullName: obj.fullName || obj["Student Full Name"] || "",
        firstName: obj.firstName || obj["Student First Name"] || "",
        lastName: obj.lastName || obj["Student Last Name"] || "",
        email: obj.email || obj["Student Email ID"] || "",
        phone: obj.phone || obj["Student Mobile No."] || "",
        alternatePhone: obj.alternatePhone || obj["Alternate Mobile No"] || "",
        alternateEmail: obj.alternateEmail || obj["Alternate Email ID"] || "",
        department: obj.department || obj.Department || "",
        year: obj.year || obj.Year || "",
        semester: obj.semester || obj.Semester || "",
        section: obj.section || obj.Section || "",
        admissionType: obj.admissionType || obj["Admission Type:"] || "",
        gender: obj.gender || obj.Gender || "",
        dob: obj.dob || obj["Date of Birth"] ? new Date(obj.dob || obj["Date of Birth"]) : null,
        bloodGroup: obj.bloodGroup || obj["Blood Group"] || "",
        religion: obj.religion || obj.Religion || "",
        category: obj.category || obj["Category:"] || "",
        isHostelStudent: (obj.isHostelStudent || obj["Hosteller:"]) === "Yes",
        hasTransportation: (obj.hasTransportation || obj["Transportation:"]) === "Yes",
        isNriOciPio: (obj.isNriOciPio || obj["NRI/OCI/International Student/PIO :"]) === "Yes",
        isPhysicallyDisabled: (obj.isPhysicallyDisabled || obj["Physically Disabled:"]) === "Yes",
        aadharNo: obj.aadharNo || obj["Aadhar No."] || "",
        abcId: obj.abcId || obj["ABC ID:"] || "",
        umisNumber: obj.umisNumber || obj["UMIS Number:"] || "",
        emisNumber: obj.emisNumber || obj["EMIS Number:"] || "",
        familyIncome: obj.familyIncome || obj["Family Income:"] || ""
      };
    }).filter(s => s.fullName);

    if (students.length === 0) {
      return res.status(400).json({ error: { message: "No valid student rows found in CSV" } });
    }

    const result = await Student.insertMany(students, { ordered: false });
    res.status(201).json({ message: `Imported ${result.length} students`, inserted: result.length });
  } catch (err) {
    if (err.writeErrors) {
      return res.status(207).json({ message: `Partial import — ${err.insertedDocs?.length || 0} inserted, ${err.writeErrors.length} skipped` });
    }
    next(err);
  }
});

// ── POST /students/seed — demo data ──────────────────────────────────────────
router.post("/seed", async (req, res, next) => {
  try {
    const demoStudents = [
      { registrationNo: "730521101001", fullName: "Adithya R", firstName: "Adithya", lastName: "R", department: "IT", year: "1", semester: "1", gender: "Male", isHostelStudent: true, hasArrears: false, email: "adithya.r@example.com", phone: "9876543201", religion: "Hindu", category: "OC" },
      { registrationNo: "730521101002", fullName: "Bhavana S", firstName: "Bhavana", lastName: "S", department: "IT", year: "1", semester: "1", gender: "Female", isHostelStudent: false, hasArrears: false, email: "bhavana.s@example.com", phone: "9876543202", religion: "Hindu", category: "BC" },
      { registrationNo: "730521102003", fullName: "Chaitanya K", firstName: "Chaitanya", lastName: "K", department: "CSE", year: "2", semester: "3", gender: "Male", isHostelStudent: true, hasArrears: true, failedInModelExams: ["Model-I"], email: "chaitanya.k@example.com", phone: "9876543203", category: "MBC" },
      { registrationNo: "730521102004", fullName: "Divya M", firstName: "Divya", lastName: "M", department: "CSE", year: "2", semester: "3", gender: "Female", isHostelStudent: false, hasArrears: false, email: "divya.m@example.com", phone: "9876543204", category: "OC" },
      { registrationNo: "730521103005", fullName: "Eswar P", firstName: "Eswar", lastName: "P", department: "ECE", year: "3", semester: "5", gender: "Male", isHostelStudent: true, hasArrears: false, email: "eswar.p@example.com", phone: "9876543205", category: "SC" },
      { registrationNo: "730521103006", fullName: "Farhana Z", firstName: "Farhana", lastName: "Z", department: "ECE", year: "3", semester: "5", gender: "Female", isHostelStudent: false, hasArrears: true, email: "farhana.z@example.com", phone: "9876543206", religion: "Muslim", category: "BCM" },
      { registrationNo: "730521104007", fullName: "Gokul N", firstName: "Gokul", lastName: "N", department: "MECH", year: "4", semester: "7", gender: "Male", isHostelStudent: true, hasArrears: false, email: "gokul.n@example.com", phone: "9876543207", category: "OBC" },
      { registrationNo: "730521104008", fullName: "Harini V", firstName: "Harini", lastName: "V", department: "MECH", year: "4", semester: "7", gender: "Female", isHostelStudent: false, hasArrears: false, email: "harini.v@example.com", phone: "9876543208", category: "OC" },
      { registrationNo: "730521101009", fullName: "Ishaan T", firstName: "Ishaan", lastName: "T", department: "CIVIL", year: "1", semester: "1", gender: "Male", isHostelStudent: true, hasArrears: true, email: "ishaan.t@example.com", phone: "9876543209", category: "ST" },
      { registrationNo: "730521102010", fullName: "Janani R", firstName: "Janani", lastName: "R", department: "EEE", year: "2", semester: "3", gender: "Female", isHostelStudent: false, hasArrears: false, email: "janani.r@example.com", phone: "9876543210", category: "BC" },
      { registrationNo: "730521105011", fullName: "Karthik S", firstName: "Karthik", lastName: "S", department: "IT", year: "3", semester: "5", gender: "Male", isHostelStudent: true, hasArrears: true, failedInModelExams: ["Model-I", "Model-II"], email: "karthik.s@example.com", phone: "9876543211", category: "MBC" },
      { registrationNo: "730521105012", fullName: "Lakshmi P", firstName: "Lakshmi", lastName: "P", department: "CSE", year: "4", semester: "8", gender: "Female", isHostelStudent: false, hasArrears: false, email: "lakshmi.p@example.com", phone: "9876543212", category: "OC" },
      { registrationNo: "FAC001", fullName: "Dr. Mani Kumar", firstName: "Mani", lastName: "Kumar", department: "IT", year: "", semester: "", gender: "Male", role: "faculty", isHostelStudent: false, email: "mani.kumar@example.com", phone: "9876543213" },
      { registrationNo: "FAC002", fullName: "Prof. Lakshmi S", firstName: "Lakshmi", lastName: "S", department: "CSE", year: "", semester: "", gender: "Female", role: "faculty", isHostelStudent: false, email: "lakshmi.s@example.com", phone: "9876543214" }
    ];

    await Student.deleteMany({ tenantId: req.tenantId });
    const result = await Student.insertMany(demoStudents.map(s => ({ ...s, tenantId: req.tenantId })));
    res.status(201).json({ message: "Demo students seeded", count: result.length });
  } catch (err) {
    next(err);
  }
});

// ── GET /students/:id ─────────────────────────────────────────────────────────
router.get("/:id", async (req, res, next) => {
  try {
    const student = await Student.findOne({ tenantId: req.tenantId, _id: req.params.id }).lean();
    if (!student) return res.status(404).json({ error: { message: "Student not found" } });
    res.json({ student });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /students/:id ───────────────────────────────────────────────────────
router.patch("/:id", async (req, res, next) => {
  try {
    const student = await Student.findOneAndUpdate(
      { tenantId: req.tenantId, _id: req.params.id },
      { $set: req.body },
      { new: true, runValidators: true }
    ).lean();
    if (!student) return res.status(404).json({ error: { message: "Student not found" } });
    res.json({ student });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /students/:id (soft delete) ───────────────────────────────────────
router.delete("/:id", async (req, res, next) => {
  try {
    await Student.findOneAndUpdate({ tenantId: req.tenantId, _id: req.params.id }, { $set: { isActive: false } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

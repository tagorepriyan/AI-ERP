const Student = require("../../models/Student");

// ─── Utility helpers ────────────────────────────────────────────────────────

function normalize(str) {
  return (str || "").toLowerCase().trim();
}

function textContains(haystack, needle) {
  return normalize(haystack).includes(normalize(needle));
}

function anyTextContains(texts, needle) {
  return texts.some((t) => textContains(t, needle));
}

// ─── Condition Parsers ───────────────────────────────────────────────────────
// Each parser reads the AI-extracted structured document and returns
// one or more MongoDB query fragments + human-readable condition labels.

/**
 * Parse targetAudience array into role/category conditions.
 * e.g. ["hostel students"] → { isHostelStudent: true }
 *      ["faculty"] → { role: "faculty" }
 */
function parseAudienceConditions(targetAudience = []) {
  const conditions = [];

  for (const audience of targetAudience) {
    const a = normalize(audience);

    if (a.includes("hostel")) {
      conditions.push({ label: "isHostelStudent", query: { isHostelStudent: true } });
    }
    if (a.includes("all student") || a.includes("students")) {
      conditions.push({ label: "role:student", query: { role: "student" } });
    }
    if (a.includes("faculty") || a.includes("staff")) {
      conditions.push({ label: "role:faculty", query: { role: { $in: ["faculty", "hod", "staff"] } } });
    }
    if (a.includes("admin")) {
      conditions.push({ label: "role:admin", query: { role: "admin" } });
    }
    if (a.includes("hod") || a.includes("head of department")) {
      conditions.push({ label: "role:hod", query: { role: "hod" } });
    }
  }

  if (conditions.length === 0) {
    // Default: target all users if audience is unspecified
    conditions.push({ label: "all_users", query: {} });
  }

  return conditions;
}

/**
 * Parse schedule sections for department and year/semester conditions.
 * e.g. schedule[].semester = "First Semester" → { semester: { $in: ["1", "First Semester"] } }
 */
function parseScheduleConditions(sections = {}) {
  const conditions = [];
  const schedule = Array.isArray(sections.schedule) ? sections.schedule : [];

  const semesterValues = new Set();
  const studentTypeFilters = [];

  for (const entry of schedule) {
    // Capture semesters
    const sem = normalize(entry.semester || "");
    if (sem) {
      if (sem.includes("first")) semesterValues.add("1");
      if (sem.includes("second")) semesterValues.add("2");
      if (sem.includes("third")) semesterValues.add("3");
      if (sem.includes("fourth")) semesterValues.add("4");
      if (sem.includes("fifth")) semesterValues.add("5");
      if (sem.includes("sixth")) semesterValues.add("6");
      if (sem.includes("seventh")) semesterValues.add("7");
      if (sem.includes("eighth")) semesterValues.add("8");

      // e.g. "Second Semester onwards" → semesters 2-8
      if (sem.includes("onwards")) {
        const start = sem.includes("second") ? 2 : sem.includes("third") ? 3 : 1;
        for (let i = start; i <= 8; i++) semesterValues.add(String(i));
      }
    }

    // Capture student type conditions (arrears / failed)
    const studentDesc = normalize(entry.students || "");
    if (studentDesc.includes("arrear") || studentDesc.includes("failed in") || studentDesc.includes("fail")) {
      studentTypeFilters.push(entry.students || "");
    }
    if (studentDesc.includes("all student")) {
      // "all students" — no additional filter
    }
  }

  if (semesterValues.size > 0) {
    const semArray = [...semesterValues];
    conditions.push({
      label: `semester:${semArray.join(",")}`,
      query: { semester: { $in: semArray } }
    });
  }

  if (studentTypeFilters.length > 0) {
    // At least one schedule entry targets students with arrears/failures
    conditions.push({
      label: "hasArrears:true",
      query: { hasArrears: true }
    });
  }

  return conditions;
}

/**
 * Parse departments from events or structured sections.
 */
function parseDepartmentConditions(events = [], structured = {}) {
  const conditions = [];
  const depts = new Set();

  // From events
  for (const event of events) {
    for (const dept of event.departments || []) {
      if (dept) depts.add(normalize(dept));
    }
  }

  // From targetAudience text
  for (const audience of structured.targetAudience || []) {
    const a = normalize(audience);
    if (a.includes("cse") || a.includes("computer")) depts.add("cse");
    if (a.includes("ece") || a.includes("electronics")) depts.add("ece");
    if (a.includes("mech") || a.includes("mechanical")) depts.add("mech");
    if (a.includes("civil")) depts.add("civil");
    if (a.includes("it ") || a === "it" || a.includes("information tech")) depts.add("it");
    if (a.includes("eee") || a.includes("electrical")) depts.add("eee");
  }

  if (depts.size > 0) {
    const deptArray = [...depts];
    conditions.push({
      label: `department:${deptArray.join(",")}`,
      query: {
        department: {
          $in: deptArray.map((d) => new RegExp(`^${d}$`, "i"))
        }
      }
    });
  }

  return conditions;
}

/**
 * Parse restrictions/rules sections for additional condition signals.
 * e.g. "not permitted to leave the hostel" → isHostelStudent
 */
function parseRulesAndRestrictions(sections = {}) {
  const conditions = [];
  const allText = [
    ...(sections.rules || []),
    ...(sections.restrictions || []),
    ...(sections.announcements || []),
    ...(sections.instructions || [])
  ].join(" ");

  if (textContains(allText, "hostel")) {
    conditions.push({ label: "isHostelStudent (from rules)", query: { isHostelStudent: true } });
  }
  if (textContains(allText, "arrear") || textContains(allText, "failed in")) {
    conditions.push({ label: "hasArrears (from rules)", query: { hasArrears: true } });
  }
  if (textContains(allText, "faculty") || textContains(allText, "staff")) {
    conditions.push({ label: "role:faculty (from rules)", query: { role: { $in: ["faculty", "staff"] } } });
  }

  return conditions;
}

// ─── Condition Merger ────────────────────────────────────────────────────────
/**
 * Merge multiple condition objects into one MongoDB $or / $and query.
 * Strategy:
 *   - Same-field conditions are OR'd together within the field.
 *   - Cross-field conditions are AND'd.
 */
function buildMatchQuery(conditionGroups, baseQuery = {}) {
  // Collect all query fragments, deduplicate
  const uniqueLabels = new Set();
  const queryFragments = [];

  for (const condition of conditionGroups) {
    if (uniqueLabels.has(condition.label)) continue;
    uniqueLabels.add(condition.label);

    if (Object.keys(condition.query).length > 0) {
      queryFragments.push(condition.query);
    }
  }

  if (queryFragments.length === 0) {
    return baseQuery; // No conditions — match everyone
  }

  // Merge all fragments: AND them all together so we get the most targeted match
  const merged = Object.assign({}, baseQuery, ...queryFragments);
  return merged;
}

// ─── Main Routing Function ───────────────────────────────────────────────────

/**
 * Derives recipients for a processed document.
 *
 * @param {string} tenantId
 * @param {object} extraction - The full extraction result from the AI/local pipeline
 * @returns {Promise<{ recipients: Array, conditionLabels: string[], matchQuery: object }>}
 */
async function deriveRecipients(tenantId, extraction) {
  const structured = extraction?.structured || {};
  const events = extraction?.events || [];
  const sections = structured?.sections || {};

  // 1. Parse all condition signals from the AI output
  const audienceConditions = parseAudienceConditions(structured.targetAudience || []);
  const scheduleConditions = parseScheduleConditions(sections);
  const deptConditions = parseDepartmentConditions(events, structured);
  const ruleConditions = parseRulesAndRestrictions(sections);

  const allConditions = [
    ...audienceConditions,
    ...scheduleConditions,
    ...deptConditions,
    ...ruleConditions
  ];

  const conditionLabels = [...new Set(allConditions.map((c) => c.label))];

  // 2. Build the MongoDB query
  const baseQuery = { tenantId, isActive: true };
  const matchQuery = buildMatchQuery(allConditions, baseQuery);

  // 3. Query the Student database for matching students
  const recipients = await Student.find(matchQuery)
    .select("registrationNo fullName email phone role department year semester section isHostelStudent hasArrears failedInModelExams notificationPreferences")
    .lean();

  return {
    recipients,
    conditionLabels,
    matchQuery
  };
}

module.exports = { deriveRecipients };

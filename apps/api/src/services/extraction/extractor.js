const env = require("../../config/env");
const fs = require("fs/promises");
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const { pdfToPng } = require("pdf-to-png-converter");

function detectMimeTypeFromFilePath(filePath) {
  const ext = path.extname(filePath || "").toLowerCase();
  const byExt = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".gif": "image/gif",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
    ".log": "text/plain"
  };

  return byExt[ext] || "application/octet-stream";
}

function normalizeTextValue(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function deriveEventFingerprint(item, index) {
  const subject = normalizeTextValue(item.subjectCode || item.subjectName || "UNKNOWN")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  const date = normalizeTextValue(item.date || "NO_DATE").replace(/[^A-Za-z0-9]+/g, "");
  return `${subject}_${date}_${index + 1}`;
}

function normalizeEvent(item, index) {
  return {
    eventId: normalizeTextValue(item.eventId) || deriveEventFingerprint(item, index),
    date: normalizeTextValue(item.date),
    startTime: normalizeTextValue(item.startTime),
    endTime: normalizeTextValue(item.endTime),
    subjectCode: normalizeTextValue(item.subjectCode),
    subjectName: normalizeTextValue(item.subjectName),
    instructions: normalizeTextValue(item.instructions),
    departments: Array.isArray(item.departments) ? item.departments.map(normalizeTextValue).filter(Boolean) : [],
    years: Array.isArray(item.years) ? item.years.map(normalizeTextValue).filter(Boolean) : [],
    sections: Array.isArray(item.sections) ? item.sections.map(normalizeTextValue).filter(Boolean) : [],
    confidence: Number.isFinite(item.confidence) ? item.confidence : 0.5
  };
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeTextValue).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[,/;|]/)
      .map(normalizeTextValue)
      .filter(Boolean);
  }

  return [];
}

function normalizeTimeRange(value) {
  const normalized = normalizeTextValue(value);

  if (!normalized) {
    return { startTime: "", endTime: "" };
  }

  const rangeMatch = normalized.match(
    /(\d{1,2}[:.]\d{2}\s*(?:AM|PM|A\.?M\.?|P\.?M\.?)?)\s*(?:-|–|to|until|through)\s*(\d{1,2}[:.]\d{2}\s*(?:AM|PM|A\.?M\.?|P\.?M\.?)?)/i
  );

  if (rangeMatch) {
    return {
      startTime: normalizeTextValue(rangeMatch[1]),
      endTime: normalizeTextValue(rangeMatch[2])
    };
  }

  return { startTime: normalized, endTime: "" };
}

function extractSemester(text) {
  const normalized = normalizeTextValue(text);
  const patterns = [
    /\b(?:I|II|III|IV|V|VI|VII|VIII|IX|X|1ST|2ND|3RD|4TH|5TH|6TH|7TH|8TH|9TH|10TH)\s*(?:SEM(?:ESTER)?)\b/i,
    /\b(?:SEM(?:ESTER)?)\s*[:\-]?\s*(?:I|II|III|IV|V|VI|VII|VIII|IX|X|1ST|2ND|3RD|4TH|5TH|6TH|7TH|8TH|9TH|10TH)\b/i
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      return normalizeTextValue(match[0]).replace(/\s+/g, " ").replace(/\bSEM\b/i, "SEMESTER");
    }
  }

  return "";
}

function extractTitleCandidate(text) {
  const lines = (text || "")
    .split(/\r?\n/)
    .map(normalizeTextValue)
    .filter(Boolean);

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.includes("TIMETABLE") || upper.includes("TIME TABLE") || upper.includes("EXAM")) {
      return line;
    }
  }

  return lines[0] || "";
}

function normalizeJsonValue(value) {
  if (typeof value === "string") {
    return normalizeTextValue(value);
  }

  if (Array.isArray(value)) {
    return value.map(normalizeJsonValue).filter((item) => {
      if (typeof item === "string") {
        return Boolean(item);
      }
      if (Array.isArray(item)) {
        return item.length > 0;
      }
      if (item && typeof item === "object") {
        return Object.keys(item).length > 0;
      }
      return item !== null && item !== undefined;
    });
  }

  if (value && typeof value === "object") {
    const normalized = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      const cleaned = normalizeJsonValue(nestedValue);
      if (typeof cleaned === "string" && !cleaned) {
        continue;
      }
      if (Array.isArray(cleaned) && cleaned.length === 0) {
        continue;
      }
      if (cleaned && typeof cleaned === "object" && !Array.isArray(cleaned) && Object.keys(cleaned).length === 0) {
        continue;
      }
      normalized[key] = cleaned;
    }
    return normalized;
  }

  return value;
}

function normalizeDocumentType(rawType) {
  const valid = new Set(["timetable", "circular", "policy", "announcement", "instruction", "mixed"]);

  if (Array.isArray(rawType)) {
    const cleaned = rawType.map((item) => normalizeTextValue(item).toLowerCase()).filter((item) => valid.has(item));
    if (cleaned.length === 1) {
      return cleaned[0];
    }
    return cleaned.length > 1 ? "mixed" : "announcement";
  }

  const cleaned = normalizeTextValue(rawType).toLowerCase();
  if (valid.has(cleaned)) {
    return cleaned;
  }

  return "announcement";
}

function normalizeStructuredDocument(parsed, fallbackDocType) {
  const sections = parsed?.sections && typeof parsed.sections === "object" ? parsed.sections : {};
  const normalizedSections = {
    schedule: Array.isArray(sections.schedule) ? normalizeJsonValue(sections.schedule) : [],
    rules: Array.isArray(sections.rules) ? normalizeJsonValue(sections.rules) : [],
    instructions: Array.isArray(sections.instructions) ? normalizeJsonValue(sections.instructions) : [],
    restrictions: Array.isArray(sections.restrictions) ? normalizeJsonValue(sections.restrictions) : [],
    announcements: Array.isArray(sections.announcements) ? normalizeJsonValue(sections.announcements) : []
  };

  const fallbackType =
    fallbackDocType === "exam_timetable" ? "timetable" : fallbackDocType === "circular" ? "circular" : "announcement";

  return {
    documentType: normalizeDocumentType(parsed?.documentType || parsed?.documentTypes || fallbackType),
    title: normalizeTextValue(parsed?.title),
    date: normalizeTextValue(parsed?.date),
    summary: normalizeTextValue(parsed?.summary),
    intent: normalizeJsonValue(
      parsed?.intent || {
        purpose: normalizeTextValue(parsed?.purpose),
        mode: normalizeTextValue(parsed?.mode || parsed?.intentType)
      }
    ),
    targetAudience: normalizeStringArray(parsed?.targetAudience),
    semester: normalizeTextValue(parsed?.semester),
    examSession: {
      startTime: normalizeTextValue(parsed?.examSession?.startTime),
      endTime: normalizeTextValue(parsed?.examSession?.endTime)
    },
    schedule: Array.isArray(parsed?.schedule) ? normalizeJsonValue(parsed.schedule) : [],
    sections: normalizedSections
  };
}

function buildStructuredFromEvents(docType, events) {
  const mappedType = docType === "exam_timetable" ? "timetable" : docType === "circular" ? "circular" : "announcement";
  return {
    documentType: mappedType,
    title: "",
    date: events.find((event) => event.date)?.date || "",
    summary: events.length
      ? `Extracted ${events.length} structured item${events.length > 1 ? "s" : ""} from document.`
      : "No structured data could be extracted.",
    intent: {
      purpose: docType === "exam_timetable" ? "Publish exam schedule" : "Inform students and faculty",
      mode: docType === "exam_timetable" ? "scheduling" : "informing"
    },
    targetAudience: [],
    semester: "",
    examSession: { startTime: "", endTime: "" },
    schedule: [],
    sections: {
      schedule: events.map((event) => ({
        date: event.date,
        startTime: event.startTime,
        endTime: event.endTime,
        subjectCode: event.subjectCode,
        subjectName: event.subjectName,
        departments: event.departments,
        years: event.years,
        sections: event.sections,
        instructions: event.instructions
      })),
      rules: [],
      instructions: [],
      restrictions: [],
      announcements: []
    }
  };
}

function buildStructuredTimetable({ rawText, structuredData, events }) {
  const normalizedText = normalizeTextValue(rawText);
  const sourceRows = [];

  if (structuredData && Array.isArray(structuredData.pages)) {
    for (const page of structuredData.pages) {
      if (!Array.isArray(page.rows)) {
        continue;
      }

      for (const row of page.rows) {
        if (!row?.date) {
          continue;
        }

        const subjects = Array.isArray(row.exams)
          ? row.exams
              .map((exam) => ({
                department: normalizeTextValue(exam.department),
                subjectCode: normalizeTextValue(exam.code),
                subjectName: normalizeTextValue(exam.subject)
              }))
              .filter((subject) => subject.department || subject.subjectCode || subject.subjectName)
          : [];

        if (subjects.length > 0) {
          sourceRows.push({
            date: normalizeTextValue(row.date),
            subjects
          });
        }
      }
    }
  }

  if (!sourceRows.length && events.length) {
    const grouped = new Map();

    for (const event of events) {
      const date = normalizeTextValue(event.date);
      if (!grouped.has(date)) {
        grouped.set(date, []);
      }

      grouped.get(date).push({
        department: event.departments[0] || "",
        subjectCode: event.subjectCode,
        subjectName: event.subjectName
      });
    }

    for (const [date, subjects] of grouped.entries()) {
      sourceRows.push({ date, subjects });
    }
  }

  const semester = extractSemester(rawText);
  const sessionRange = normalizeTimeRange(
    normalizedText.match(/\b\d{1,2}[:.]\d{2}\s*(?:AM|PM|A\.?M\.?|P\.?M\.?)?\s*(?:-|–|to|until|through)\s*\d{1,2}[:.]\d{2}\s*(?:AM|PM|A\.?M\.?|P\.?M\.?)?\b/i)?.[0] || ""
  );

  return {
    documentType: "timetable",
    title: extractTitleCandidate(normalizedText),
    date: normalizeTextValue(normalizedText.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/)?.[0] || ""),
    summary: sourceRows.length
      ? `Timetable with ${sourceRows.length} date row${sourceRows.length > 1 ? "s" : ""}.`
      : "Timetable extracted from document.",
    intent: {
      purpose: "Publish exam timetable",
      mode: "scheduling"
    },
    targetAudience: [],
    semester,
    examSession: sessionRange,
    schedule: sourceRows,
    sections: {
      schedule: sourceRows,
      rules: [],
      instructions: [],
      restrictions: [],
      announcements: []
    }
  };
}

function toScheduleEvent(item, index) {
  const source = item && typeof item === "object" ? item : { subjectName: String(item || "") };
  const timeValue = normalizeTextValue(source.time);
  const startFromRange = timeValue.split(/\s*(?:-|–|to)\s*/i)[0] || "";
  const endFromRange = timeValue.split(/\s*(?:-|–|to)\s*/i)[1] || "";

  return normalizeEvent(
    {
      date: source.date || source.examDate || source.day || "",
      startTime: source.startTime || source.from || startFromRange,
      endTime: source.endTime || source.to || endFromRange,
      subjectCode: source.subjectCode || source.code || "",
      subjectName: source.subjectName || source.subject || source.title || source.exam || "",
      instructions: source.instructions || source.action || source.note || source.students || "",
      departments: normalizeStringArray(source.departments || source.department),
      years: normalizeStringArray(source.years || source.year || source.semester),
      sections: normalizeStringArray(source.sections || source.section),
      confidence: Number.isFinite(source.confidence) ? source.confidence : 0.82
    },
    index
  );
}

function timetableToEvents(structuredTimetable) {
  const events = [];
  const scheduleRows = Array.isArray(structuredTimetable?.schedule) ? structuredTimetable.schedule : [];

  for (const row of scheduleRows) {
    const date = normalizeTextValue(row?.date);
    const subjects = Array.isArray(row?.subjects) ? row.subjects : [];

    for (const subject of subjects) {
      events.push(
        normalizeEvent(
          {
            date,
            subjectCode: normalizeTextValue(subject.subjectCode),
            subjectName: normalizeTextValue(subject.subjectName),
            departments: normalizeStringArray(subject.department),
            confidence: 0.9
          },
          events.length
        )
      );
    }
  }

  return events;
}

function isLikelyHeadingLine(line) {
  const normalized = normalizeTextValue(line);

  if (!normalized) {
    return true;
  }

  const upper = normalized.toUpperCase();
  const headingSignals = [
    "OFFICE OF",
    "CONTROLLER OF EXAMINATIONS",
    "UNIVERSITY",
    "EXAMINATION",
    "EXAMINATIONS",
    "TIMETABLE",
    "SCHEDULE",
    "NOTICE",
    "CIRCULAR"
  ];

  if (headingSignals.some((signal) => upper.includes(signal))) {
    return true;
  }

  return /^[A-Z0-9\s().,/:;-]+$/.test(normalized) && normalized.length <= 24 && normalized.split(/\s+/).length <= 3;
}

function splitTableLikeCells(line) {
  const normalized = normalizeTextValue(line);

  if (!normalized) {
    return [];
  }

  if (normalized.includes("|")) {
    return normalized.split(/\s*\|\s*/).map(normalizeTextValue).filter(Boolean);
  }

  if (/\t/.test(normalized)) {
    return normalized.split(/\t+/).map(normalizeTextValue).filter(Boolean);
  }

  if (/\s{2,}/.test(normalized)) {
    return normalized.split(/\s{2,}/).map(normalizeTextValue).filter(Boolean);
  }

  return [normalized];
}

function extractDateToken(text) {
  const normalized = normalizeTextValue(text);
  const patterns = [
    /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/,
    /\b\d{1,2}\s+[A-Z][a-z]{2,8}\s+\d{2,4}\b/,
    /\b[A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{2,4}\b/
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      return match[0].replace(/-/g, "/");
    }
  }

  return "";
}

function extractTimeToken(text) {
  const normalized = normalizeTextValue(text);
  const rangePattern = /\b\d{1,2}[:.]\d{2}\s*(?:AM|PM|A\.M\.|P\.M\.)?\s*(?:-|–|to|until|through)\s*\d{1,2}[:.]\d{2}\s*(?:AM|PM|A\.M\.|P\.M\.)?\b/i;
  const singlePattern = /\b\d{1,2}[:.]\d{2}\s*(?:AM|PM|A\.M\.|P\.M\.)?\b/i;

  const rangeMatch = normalized.match(rangePattern);
  if (rangeMatch) {
    return rangeMatch[0].replace(/\s+/g, " ").replace(/\s*(?:-|–|to|until|through)\s*/i, " - ");
  }

  const singleMatch = normalized.match(singlePattern);
  return singleMatch ? singleMatch[0].replace(/\s+/g, " ") : "";
}

function extractSubjectCodeToken(text) {
  const normalized = normalizeTextValue(text);
  const patterns = [
    /\b[A-Z]{2,6}\s?\d{2,4}[A-Z]?\b/,
    /\b\d{2}[A-Z]{2}\d{2,4}\b/,
    /\b[A-Z]{1,4}\d{2,4}[A-Z]?\b/
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match && !/^DATE$/i.test(match[0]) && !/^TIME$/i.test(match[0])) {
      return match[0].replace(/\s+/g, " ");
    }
  }

  return "";
}

function cleanSubjectCandidate(text) {
  return normalizeTextValue(text)
    .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, " ")
    .replace(/\b\d{1,2}[:.]\d{2}\s*(?:AM|PM|A\.M\.|P\.M\.)?/gi, " ")
    .replace(/\b(?:AM|PM|A\.M\.|P\.M\.)\b/gi, " ")
    .replace(/\b(?:MON|TUE|WED|THU|FRI|SAT|SUN)(?:DAY)?\b/gi, " ")
    .replace(/\b(?:DATE|VENUE|ROOM)\b/gi, " ")
    .replace(/\b(?:\d{2}[A-Z]{2}\d{2,4}|[A-Z]{2,6}\s?\d{2,4}[A-Z]?|[A-Z]{1,4}\d{2,4}[A-Z]?)\b/g, " ")
    .replace(/[\[\]():,;]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isCircularNoiseLine(text) {
  const normalized = normalizeTextValue(text);
  if (!normalized) {
    return true;
  }

  const upper = normalized.toUpperCase();
  const noisySignals = [
    "ST. JOSEPH",
    "ST JOSEPH",
    "COLLEGE OF ENGINEERING",
    "AUTONOMOUS INSTITUTION",
    "GROUP OF INSTITUTIONS",
    "OMR",
    "CHENNAI",
    "DEPARTMENT OF",
    "HOD",
    "INCHARGE",
    "PRINCIPAL",
    "DEAR STUDENTS",
    "CIRCULAR"
  ];

  if (noisySignals.some((signal) => upper.includes(signal))) {
    return true;
  }

  return normalized.length < 6 || (/^[A-Z0-9\s().,/:;'"-]+$/.test(normalized) && normalized.split(/\s+/).length <= 5);
}

function isCircularActionLine(text) {
  return /\b(deadline|submit|form|link|apply|register|fee|membership|on\s+or\s+before|on\s+before|google\s*form|http|https)\b/i.test(
    normalizeTextValue(text)
  );
}

function calculateLocalConfidence(event) {
  let confidence = 0.3;

  if (event.subjectName && event.subjectName !== "UNKNOWN") {
    confidence += 0.2;
  }

  if (event.subjectCode) {
    confidence += 0.15;
  }

  if (event.date) {
    confidence += 0.15;
  }

  if (event.startTime || event.endTime) {
    confidence += 0.1;
  }

  if (event.instructions) {
    confidence += 0.05;
  }

  return Math.min(confidence, 0.95);
}

function buildLocalEventFromText(text, docType) {
  const normalizedText = normalizeTextValue(text);
  const date = extractDateToken(normalizedText);
  const timeInfo = normalizeTimeRange(extractTimeToken(normalizedText));
  const subjectCode = extractSubjectCodeToken(normalizedText);
  const subjectName = cleanSubjectCandidate(normalizedText);

  if (docType === "circular" && isCircularNoiseLine(normalizedText) && !isCircularActionLine(normalizedText)) {
    return null;
  }

  if (!date && !subjectCode && (!subjectName || subjectName.length < 5)) {
    return null;
  }

  const departmentRules = [
    { label: "CSE", pattern: /\bCSE\b|\bCOMPUTER\s+SCIENCE\b/i },
    { label: "ECE", pattern: /\bECE\b|\bELECTRONICS\b/i },
    { label: "MECH", pattern: /\bMECH\b|\bMECHANICAL\b/i },
    { label: "CIVIL", pattern: /\bCIVIL\b/i },
    { label: "IT", pattern: /\bIT\b|\bINFORMATION\s+TECH(?:NOLOGY)?\b/i },
    { label: "EEE", pattern: /\bEEE\b|\bELECTRICAL\b/i }
  ];
  const depts = departmentRules.filter((rule) => rule.pattern.test(normalizedText)).map((rule) => rule.label);

  let conciseSubjectName = subjectName || (subjectCode ? "UNKNOWN_SUBJECT" : "UNKNOWN");
  let instructions = "";
  if (docType === "circular") {
    if (conciseSubjectName.length > 96) {
      instructions = normalizedText;
      conciseSubjectName = conciseSubjectName.slice(0, 96).trim();
    } else if (isCircularActionLine(normalizedText) && normalizedText.length > conciseSubjectName.length + 25) {
      instructions = normalizedText;
    }
  }

  const event = {
    date,
    startTime: timeInfo.startTime,
    endTime: timeInfo.endTime,
    subjectCode,
    subjectName: conciseSubjectName,
    instructions,
    departments: docType === "circular" ? depts : [],
    years: [],
    sections: []
  };

  event.confidence = calculateLocalConfidence(event);
  return event;
}

function buildLocalResult(events, docType) {
  return buildResult({
    provider: "local-hybrid",
    model: "pdfplumber+easyocr+heuristics",
    events,
    structured: buildStructuredFromEvents(docType, events),
    emptyWarning: "Local hybrid extractor found no structured events"
  });
}

function processStructuredGridPages({ structuredData, docType }) {
  if (!structuredData || !Array.isArray(structuredData.pages)) {
    return [];
  }

  const events = [];
  const seen = new Set();

  for (const page of structuredData.pages) {
    if (!Array.isArray(page.rows)) {
      continue;
    }

    for (const row of page.rows) {
      const date = normalizeTextValue(row.date);

      if (!date || !Array.isArray(row.exams)) {
        continue;
      }

      for (const exam of row.exams) {
        const department = normalizeTextValue(exam.department);
        const subject = normalizeTextValue(exam.subject);
        const code = normalizeTextValue(exam.code);

        if (!subject && !code) {
          continue;
        }

        const eventKey = `${date}|${department}|${subject}|${code}`;
        if (seen.has(eventKey)) {
          continue;
        }

        seen.add(eventKey);

        const event = normalizeEvent(
          {
            date,
            startTime: normalizeTextValue(row.time),
            endTime: "",
            subjectCode: code,
            subjectName: subject,
            instructions: "",
            departments: department ? [department] : [],
            years: [],
            sections: [],
            confidence: 0.92 // High confidence for grid-based extraction
          },
          events.length
        );

        events.push(event);
      }
    }
  }

  return events;
}

function extractJsonPayload(text) {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "");

  const objectIndex = cleaned.indexOf("{");
  const arrayIndex = cleaned.indexOf("[");
  const start = objectIndex === -1 ? arrayIndex : arrayIndex === -1 ? objectIndex : Math.min(objectIndex, arrayIndex);

  if (start === -1) {
    return cleaned;
  }

  const stack = [];
  let inString = false;
  let escape = false;

  for (let i = start; i < cleaned.length; i++) {
    const char = cleaned[i];

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }

      if (char === "\\") {
        escape = true;
        continue;
      }

      if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }

    if (char === "}" || char === "]") {
      const open = stack.pop();

      if (!open) {
        break;
      }

      if ((open === "{" && char !== "}") || (open === "[" && char !== "]")) {
        break;
      }

      if (!stack.length) {
        return cleaned.slice(start, i + 1);
      }
    }
  }

  return cleaned.slice(start);
}

function parseJsonPayload(text) {
  return JSON.parse(extractJsonPayload(text));
}

function buildExtractionPrompt(docType) {
  const docHint = docType === "exam_timetable" ? "timetable" : docType;

  if (docHint === "timetable") {
    return [
      "You are an intelligent document understanding system for academic ERP platforms.",
      "The document is a timetable. Preserve the table layout.",
      "Step A: Detect the table structure where rows are dates and columns are departments/branches.",
      "Step B: Extract column headers as standardized department names.",
      "Step C: Map each cell to the correct department and extract subjectCode and subjectName.",
      "Step D: Extract global context such as semester and exam session timing.",
      "Step E: Clean OCR noise and keep each subject linked to its correct department.",
      "Return strict JSON only with this shape:",
      '{"documentType":"timetable","semester":"","examSession":{"startTime":"","endTime":""},"schedule":[{"date":"","subjects":[{"department":"","subjectCode":"","subjectName":""}]}]}',
      "No markdown fences. No extra commentary.",
      "Do not flatten the timetable into random events."
    ].join("\n");
  }

  return [
    "You are an intelligent document understanding system for academic ERP platforms.",
    `Input hint: ${docHint}.`,
    "Step 1: Classify documentType as one of timetable, circular, policy, announcement, instruction, mixed.",
    "Step 2: Infer intent with concise purpose and mode (informing, scheduling, restricting, instructing, or mixed).",
    "Step 3: Build meaningful sections dynamically. Use only relevant sections from schedule, rules, instructions, restrictions, announcements.",
    "Step 4: Normalize dates to YYYY-MM-DD when possible and standardize times.",
    "Step 5: Extract clean entities in targetAudience and schedule entries: departments, years/semester, student types.",
    "Do not force all content into events. Avoid duplication. Preserve relationships for conditional rules.",
    "Return strict JSON only with this shape:",
    '{"documentType":"announcement","title":"","date":"","summary":"","intent":{"purpose":"","mode":"informing"},"targetAudience":[],"sections":{"schedule":[],"rules":[],"instructions":[],"restrictions":[],"announcements":[]}}',
    "No markdown fences. No extra commentary."
  ].join("\n");
}

function attachAbortSignal(controller, signal) {
  if (!signal) {
    return controller.signal;
  }

  if (signal.aborted) {
    controller.abort(signal.reason);
    return controller.signal;
  }

  signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  return controller.signal;
}

function emitProgressText(onProgressText, text) {
  if (typeof onProgressText !== "function") {
    return;
  }

  const normalized = normalizeTextValue(text);
  if (!normalized) {
    return;
  }

  onProgressText(normalized.slice(-220));
}

function trimBase64DataUrl(value) {
  return String(value || "").replace(/^data:[^;]+;base64,/i, "").replace(/\s+/g, "");
}

async function normalizeImageToJpeg(imageInput, maxSide = Number(env.ai.ollama.pdfImageSize || 768)) {
  const resolvedMaxSide = Math.max(1, Math.floor(Number(maxSide) || 768));
  const sourceBuffer = Buffer.isBuffer(imageInput)
    ? imageInput
    : Buffer.from(trimBase64DataUrl(imageInput), "base64");

  if (!sourceBuffer.length) {
    throw new Error("Image buffer is empty");
  }

  const image = await loadImage(sourceBuffer);
  const scale = Math.min(resolvedMaxSide / image.width, resolvedMaxSide / image.height, 1);
  const targetWidth = Math.max(1, Math.round(image.width * scale));
  const targetHeight = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(resolvedMaxSide, resolvedMaxSide);
  const ctx = canvas.getContext("2d");
  const offsetX = Math.floor((resolvedMaxSide - targetWidth) / 2);
  const offsetY = Math.floor((resolvedMaxSide - targetHeight) / 2);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, resolvedMaxSide, resolvedMaxSide);
  ctx.drawImage(image, offsetX, offsetY, targetWidth, targetHeight);

  // JPEG is more widely supported for local vision models and results in smaller payloads
  return canvas.toBuffer("image/jpeg");
}

function getProviderModel(provider) {
  return normalizeTextValue(provider).toLowerCase() === "ollama" ? env.ai.ollama.model : env.ai.gemini.model;
}

function buildProviderFallbackResult({ provider, docType, rawText, structuredData, localFallbackResult, providerErrors, message }) {
  const normalizedProvider = normalizeTextValue(provider).toLowerCase();
  const fallbackModel = getProviderModel(normalizedProvider);
  const baseResult = localFallbackResult.events.length > 0
    ? localFallbackResult
    : {
        provider: normalizedProvider || "stub",
        model: fallbackModel,
        confidenceScore: 0.1,
        structured: docType === "exam_timetable" ? buildStructuredTimetable({ rawText, structuredData, events: [] }) : buildStructuredFromEvents(docType, []),
        events: []
      };

  return {
    ...baseResult,
    provider: normalizedProvider || baseResult.provider,
    model: baseResult.model || fallbackModel,
    warnings: [
      ...(localFallbackResult.warnings || []),
      message,
      `Errors from AI providers during attempt: ${providerErrors.join(" | ")}`
    ]
  };
}

async function readOllamaStreamedContent(response, onProgressText) {
  if (!response.body || !response.body.getReader) {
    const payload = await response.json();
    const fallback = payload?.response || "";
    emitProgressText(onProgressText, fallback);
    return fallback;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffered = "";
  let content = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffered += decoder.decode(value, { stream: true });
    let newlineIndex = buffered.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffered.slice(0, newlineIndex).trim();
      buffered = buffered.slice(newlineIndex + 1);

      if (line) {
        try {
          const event = JSON.parse(line);
          if (typeof event.response === "string" && event.response) {
            content += event.response;
            emitProgressText(onProgressText, content);
          }
        } catch (_error) {
          // Ignore malformed stream chunks.
        }
      }

      newlineIndex = buffered.indexOf("\n");
    }
  }

  const finalChunk = buffered.trim();
  if (finalChunk) {
    try {
      const event = JSON.parse(finalChunk);
      if (typeof event.response === "string" && event.response) {
        content += event.response;
      }
    } catch (_error) {
      // Ignore malformed final chunk.
    }
  }

  emitProgressText(onProgressText, content);
  return content;
}

async function convertPdfToBase64Images(filePath, pageCount = 0, onProgressText) {
  const maxPages = Math.max(1, Math.min(Number(env.ai.ollama.maxPdfPages || 3), Number(pageCount || env.ai.ollama.maxPdfPages || 3)));
  const pagesToProcess = Array.from({ length: maxPages }, (_, index) => index + 1);

  emitProgressText(onProgressText, `Rendering up to ${maxPages} PDF page(s) for local vision...`);

  const pngPages = await pdfToPng(filePath, {
    pagesToProcess,
    viewportScale: Number(env.ai.ollama.pdfViewportScale || 1.45),
    returnPageContent: true,
    processPagesInParallel: false,
    outputFolder: undefined,
    verbosityLevel: 0
  });

  const rawPageImages = pngPages
    .map((page) => page?.content)
    .filter((content) => Buffer.isBuffer(content) && content.length > 0);

  const normalizedImages = [];
  try {
    for (let index = 0; index < rawPageImages.length; index += 1) {
      emitProgressText(onProgressText, `Converting PDF page ${index + 1}/${rawPageImages.length} to Gemma image format...`);
      // Process sequentially so live progress text reflects the real page order.
      const normalized = await normalizeImageToJpeg(rawPageImages[index]);
      normalizedImages.push(normalized.toString("base64"));
    }
  } catch (error) {
    const errorMessage = `PDF-to-image conversion failed: ${error.message}${error.stack ? `\n${error.stack}` : ""}`;
    emitProgressText(onProgressText, "❌ Fatal Error: " + errorMessage);
    throw new Error(errorMessage);
  }

  emitProgressText(onProgressText, `Prepared ${normalizedImages.length} page image(s) for local Gemma analysis.`);

  return normalizedImages;
}

function buildResult({ provider, model, events, structured, emptyWarning }) {
  const resolvedStructured = structured || buildStructuredFromEvents("notice", events);
  const sectionValues = Object.values(resolvedStructured?.sections || {});
  const hasStructuredContent =
    sectionValues.some((section) => Array.isArray(section) && section.length > 0) ||
    Boolean(normalizeTextValue(resolvedStructured?.summary)) ||
    Boolean(normalizeTextValue(resolvedStructured?.title));

  const confidenceScore =
    events.length > 0
      ? events.reduce((sum, event) => sum + event.confidence, 0) / events.length
      : hasStructuredContent
      ? 0.65
      : 0.2;

  return {
    provider,
    model,
    confidenceScore,
    warnings: events.length || hasStructuredContent ? [] : [emptyWarning],
    events,
    structured: resolvedStructured
  };
}

function parseModelOutputFromText(text, docType) {
  if (!text) {
    throw new Error("Model returned empty content");
  }

  const parsed = parseJsonPayload(text);

  if (parsed && typeof parsed === "object") {
    const structured = normalizeStructuredDocument(parsed, docType);

    if (structured.documentType === "timetable" || docType === "exam_timetable") {
      const scheduleRows = Array.isArray(structured.schedule) && structured.schedule.length > 0 ? structured.schedule : Array.isArray(structured.sections?.schedule) ? structured.sections.schedule : [];
      const timetableStructured = {
        ...structured,
        documentType: "timetable",
        schedule: Array.isArray(scheduleRows) ? scheduleRows : [],
        sections: {
          schedule: Array.isArray(scheduleRows) ? scheduleRows : [],
          rules: [],
          instructions: [],
          restrictions: [],
          announcements: []
        }
      };

      return {
        events: timetableToEvents(timetableStructured),
        structured: timetableStructured
      };
    }

    if (structured.sections) {
      const scheduleEntries = Array.isArray(structured.sections?.schedule) ? structured.sections.schedule : [];
      return {
        events: scheduleEntries.map((item, index) => toScheduleEvent(item, index)),
        structured
      };
    }
  }

  const rawEvents = Array.isArray(parsed) ? parsed : Array.isArray(parsed.events) ? parsed.events : [];
  const events = rawEvents.map((item, index) => normalizeEvent(item, index));
  return {
    events,
    structured: buildStructuredFromEvents(docType, events)
  };
}

function extractLocalEvents({ docType, rawText, structuredData }) {
  // 1. FIRST: Try structured grid data (highest fidelity)
  if (structuredData && structuredData.structure_type === "grid_timetable") {
    const gridEvents = processStructuredGridPages({ structuredData, docType });
    if (gridEvents.length > 0) {
      if (docType === "exam_timetable") {
        return buildResult({
          provider: "local-hybrid",
          model: "pdfplumber+easyocr+heuristics",
          events: gridEvents,
          structured: buildStructuredTimetable({ rawText, structuredData, events: gridEvents }),
          emptyWarning: "Local hybrid extractor found no structured events"
        });
      }

      return buildLocalResult(gridEvents, docType);
    }
  }

  // 2. FALLBACK: Text-based heuristics
  const normalizedRawText = normalizeTextValue(rawText);

  if (!normalizedRawText) {
    return buildLocalResult([], docType);
  }

  const lines = rawText
    .split(/\r?\n/)
    .map(normalizeTextValue)
    .filter(Boolean);
  const blocks = rawText
    .split(/\n{2,}/)
    .map(normalizeTextValue)
    .filter(Boolean);
  const events = [];
  const seen = new Set();
  const uniqueCandidates = (items) => Array.from(new Set(items.map(normalizeTextValue).filter(Boolean)));

  const pushCandidate = (candidateText) => {
    const candidateEvent = buildLocalEventFromText(candidateText, docType);

    if (!candidateEvent) {
      return;
    }

    const normalizedEvent = normalizeEvent(candidateEvent, events.length);
    const key = [
      normalizedEvent.date,
      normalizedEvent.startTime,
      normalizedEvent.endTime,
      normalizedEvent.subjectCode,
      normalizedEvent.subjectName
    ]
      .map((value) => normalizeTextValue(value).toLowerCase())
      .join("|");

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    events.push(normalizedEvent);
  };

  const lineCandidates = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (!line) {
      continue;
    }

    lineCandidates.push(line);

    const nextLine = lines[index + 1];
    const currentHasStructure = Boolean(extractDateToken(line) || extractTimeToken(line) || extractSubjectCodeToken(line));
    const nextHasStructure = Boolean(extractDateToken(nextLine) || extractTimeToken(nextLine) || extractSubjectCodeToken(nextLine));

    if (nextLine && currentHasStructure && !nextHasStructure && !isLikelyHeadingLine(nextLine)) {
      lineCandidates.push(`${line} ${nextLine}`);
    }
  }

  const blockCandidates = blocks.length > 1 ? blocks : lines;

  if (docType === "exam_timetable") {
    for (const candidate of lineCandidates) {
      if (isLikelyHeadingLine(candidate) && !extractDateToken(candidate) && !extractTimeToken(candidate) && !extractSubjectCodeToken(candidate)) {
        continue;
      }

      pushCandidate(candidate);
    }

    if (!events.length) {
      for (const candidate of blockCandidates) {
        pushCandidate(candidate);
      }
    }
  } else if (docType === "circular") {
    const actionableCandidates = uniqueCandidates([...lineCandidates, ...blockCandidates]).filter(
      (candidate) => isCircularActionLine(candidate) && !isCircularNoiseLine(candidate)
    );

    for (const candidate of actionableCandidates) {
      pushCandidate(candidate);
    }

    if (!events.length) {
      const fallbackCandidates = uniqueCandidates([...blockCandidates, ...lineCandidates]).filter(
        (candidate) => !isCircularNoiseLine(candidate) || isCircularActionLine(candidate)
      );

      for (const candidate of fallbackCandidates) {
        pushCandidate(candidate);
      }
    }
  } else {
    for (const candidate of blockCandidates) {
      pushCandidate(candidate);
    }

    if (!events.length) {
      for (const candidate of lineCandidates) {
        pushCandidate(candidate);
      }
    }
  }

  if (docType === "exam_timetable") {
    return buildResult({
      provider: "local-hybrid",
      model: "pdfplumber+easyocr+heuristics",
      events,
      structured: buildStructuredTimetable({ rawText, structuredData, events }),
      emptyWarning: "Local hybrid extractor found no structured events"
    });
  }

  return buildLocalResult(events, docType);
}

async function extractWithOpenAICompatibleFromText({ providerName, baseUrl, apiKey, model, docType, rawText, signal }) {
  const prompt = buildExtractionPrompt(docType);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.ai.timeoutMs);
  const requestSignal = attachAbortSignal(controller, signal);

  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

  try {
    const response = await fetch(`${normalizedBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      signal: requestSignal,
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: `Document content:\n${rawText}\n\nReturn only strict JSON.` }
        ]
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      const errorMessage = errorBody
        ? `${providerName} request failed with status ${response.status}: ${errorBody.slice(0, 500)}`
        : `${providerName} request failed with status ${response.status}`;
      throw new Error(errorMessage);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    const parsed = parseModelOutputFromText(content, docType);

    return buildResult({
      provider: providerName,
      model,
      events: parsed.events,
      structured: parsed.structured,
      emptyWarning: `${providerName} extracted no events from the text`
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function extractWithOllamaFromText({ docType, rawText, model, signal, onProgressText }) {
  const prompt = buildExtractionPrompt(docType);
  const controller = new AbortController();
  const timeoutMs = Number(env.ai.ollama.timeoutMs || 180000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const requestSignal = attachAbortSignal(controller, signal);
  const selectedModel = model || env.ai.ollama.model;

  try {
    const response = await fetch(`${env.ai.ollama.baseUrl}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      signal: requestSignal,
      body: JSON.stringify({
        model: selectedModel,
        format: "json",
        stream: true,
        options: {
          temperature: 0.1,
          num_ctx: 4096
        },
        prompt: `${prompt}\n\nDocument content:\n${rawText}\n\nReturn only strict JSON.`
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Ollama request failed with status ${response.status}: ${errorBody.slice(0, 500)}`);
    }

    const content = await readOllamaStreamedContent(response, onProgressText);
    const parsed = parseModelOutputFromText(content, docType);

    return buildResult({
      provider: "ollama-local",
      model: selectedModel,
      events: parsed.events,
      structured: parsed.structured,
      emptyWarning: `Ollama extracted no events from the text`
    });
  } finally {
    clearTimeout(timeout);
  }
}

function getGeminiModelCandidates() {
  const preferred = normalizeTextValue(env.ai.gemini.model);
  const fallbacks = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.5-pro",
    "gemini-3-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.1-pro",
    "gemini-2.0-flash"
  ];
  return [...new Set([preferred, ...fallbacks].filter(Boolean))];
}

async function callGeminiGenerateContent({ model, body, signal }) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${env.ai.gemini.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify(body)
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    const errorMessage = errorBody
      ? `Gemini request failed for ${model} with status ${response.status}: ${errorBody.slice(0, 500)}`
      : `Gemini request failed for ${model} with status ${response.status}`;
    const error = new Error(errorMessage);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

async function runGeminiWithFallbacks({ body, docType, emptyWarning, signal }) {
  const modelCandidates = getGeminiModelCandidates();
  let lastError = null;

  for (const model of modelCandidates) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.ai.timeoutMs);
    const requestSignal = attachAbortSignal(controller, signal);

    try {
      const payload = await callGeminiGenerateContent({ model, body, signal: requestSignal });
      const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
      const parsed = parseModelOutputFromText(text, docType || "notice");

      return buildResult({
        provider: "gemini",
        model,
        events: parsed.events,
        structured: parsed.structured,
        emptyWarning
      });
    } catch (error) {
      lastError = error;

      // Retry with next candidate only when the model is unavailable.
      if (!/status\s+404|not found|not supported/i.test(error.message)) {
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error("Gemini request failed for all candidate models");
}

async function extractWithGeminiFromText({ docType, rawText, signal }) {
  const prompt = buildExtractionPrompt(docType);

  return runGeminiWithFallbacks({
    body: {
      contents: [
        {
          parts: [
            { text: prompt + "\n\nDocument content:\n" + rawText }
          ]
        }
      ],
      generationConfig: {
        temperature: 0
      }
    },
    docType,
    signal,
    emptyWarning: "Gemini extracted no events from the text"
  });
}

async function extractWithGeminiFromFile({ docType, filePath, pageCount, signal }) {
  const fileBuffer = await fs.readFile(filePath);
  const base64File = fileBuffer.toString("base64");
  const mimeType = detectMimeTypeFromFilePath(filePath);

  const prompt = buildExtractionPrompt(docType);

  return runGeminiWithFallbacks({
    body: {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType,
                data: base64File
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0
      }
    },
    docType,
    signal,
    emptyWarning: "Gemini extracted no events from the uploaded file"
  });
}

async function extractWithOllamaFromPdf({ docType, filePath, pageCount, signal, onProgressText }) {
  const prompt = buildExtractionPrompt(docType);
  const controller = new AbortController();
  const timeoutMs = Number(env.ai.ollama.timeoutMs || 180000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const requestSignal = attachAbortSignal(controller, signal);
  const selectedModel = env.ai.ollama.model;

  try {
    const mimeType = detectMimeTypeFromFilePath(filePath);
    let images = [];

    if (mimeType === "application/pdf") {
      emitProgressText(onProgressText, "Converting PDF pages to images for local vision model...");
      images = await convertPdfToBase64Images(filePath, pageCount, onProgressText);
      if (!images.length) {
        throw new Error("PDF-to-image conversion produced no pages for local AI");
      }
    } else {
      emitProgressText(onProgressText, "Normalizing uploaded image for local vision model...");
      const fileBuffer = await fs.readFile(filePath);
      images = [(await normalizeImageToJpeg(fileBuffer)).toString("base64")];
    }

    emitProgressText(onProgressText, `Sending ${images.length} image(s) to local model ${selectedModel}...`);

    const response = await fetch(`${env.ai.ollama.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: requestSignal,
      body: JSON.stringify({
        model: selectedModel,
        format: "json",
        stream: true,
        options: { 
          temperature: 0.1,
          num_ctx: 8192, // Sufficient room for images + large JSON
          num_predict: 2048, // Limit response length to prevent loops
          repeat_penalty: 1.1,
          top_k: 40,
          top_p: 0.9
        },
        prompt: `${prompt}\n\nReturn only strict JSON.`,
        images
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Ollama Vision request failed with status ${response.status}: ${errorBody.slice(0, 500)}`);
    }

    emitProgressText(onProgressText, `Local model ${selectedModel} is generating structured output...`);
    const content = await readOllamaStreamedContent(response, onProgressText);
    const parsed = parseModelOutputFromText(content, docType);

    return buildResult({
      provider: "ollama",
      model: selectedModel,
      events: parsed.events,
      structured: parsed.structured,
      emptyWarning: "Local Ollama/Gemma extracted no events from the provided document"
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function extractStructuredData({ docType, rawText, filePath, pageCount, provider, structuredData, settings = {}, signal, onProgressText }) {
  const providerErrors = [];
  const requestedProvider = normalizeTextValue(provider).toLowerCase();
  const explicitProviderSelected = Boolean(requestedProvider);
  const localFallbackResult = extractLocalEvents({ docType, rawText, structuredData });
  const fastModeEnabled = settings.fastMode !== false;
  const preferLocalFirst = settings.preferLocalFirst !== false && fastModeEnabled;
  const localConfidenceThreshold = Number.isFinite(settings.localConfidenceThreshold)
    ? settings.localConfidenceThreshold
    : 0.72;
  const localHasStructuredContent =
    (localFallbackResult?.events?.length || 0) > 0 ||
    Object.values(localFallbackResult?.structured?.sections || {}).some((section) => Array.isArray(section) && section.length > 0);
  const localMeetsThreshold = (localFallbackResult?.confidenceScore || 0) >= localConfidenceThreshold;
  const allowLocalFirstForRequestedProvider =
    !explicitProviderSelected || requestedProvider === "gemini" || requestedProvider === "azure_vision";
  const withRequestedProviderTag = (result) => {
    if (!result || requestedProvider !== "azure_vision") {
      return result;
    }

    const baseProvider = normalizeTextValue(result.provider).toLowerCase();
    if (!baseProvider || baseProvider === "azure_vision") {
      return { ...result, provider: "azure_vision" };
    }

    return { ...result, provider: `azure_vision+${baseProvider}` };
  };

  // Check if AI processing is disabled via settings
  if (settings.aiEnabled === false) {
    console.log(`[extractor] AI processing disabled by settings. Falling back to local heuristics.`);
    return extractLocalEvents({ docType, rawText, structuredData });
  }

  // Fast mode: use high-confidence local extraction to avoid unnecessary cloud AI calls.
  if (preferLocalFirst && allowLocalFirstForRequestedProvider && localHasStructuredContent && localMeetsThreshold) {
    return withRequestedProviderTag({
      ...localFallbackResult,
      warnings: [
        ...(localFallbackResult.warnings || []),
        `Local-first extraction selected in fast mode (confidence ${(localFallbackResult.confidenceScore * 100).toFixed(0)}%). Cloud AI call skipped to reduce latency and cost.`
      ]
    });
  }

  // If user explicitly selected a provider in UI, honor it strictly by default.
  // Cross-provider fallback can still be opted in via settings.useFallbacks = true.
  const useFallbacks = explicitProviderSelected
    ? settings.useFallbacks === true
    : settings.useFallbacks !== false;

  const textProviders = [
    {
      name: "ollama",
      enabled: requestedProvider === "ollama",
      execute: () => extractWithOllamaFromText({ docType, rawText, model: env.ai.ollama.model, signal, onProgressText })
    },
    {
      name: "gemini",
      // Azure Vision is OCR-only in this app, so structured extraction should use Gemini.
      enabled: requestedProvider === "gemini" || requestedProvider === "azure_vision" || (!explicitProviderSelected && Boolean(env.ai.gemini.apiKey)),
      execute: () => extractWithGeminiFromText({ docType, rawText, signal })
    },
    {
      name: "groq",
      enabled: (requestedProvider === "groq" || (!explicitProviderSelected && useFallbacks)) && Boolean(env.ai.groq.apiKey),
      execute: () =>
        extractWithOpenAICompatibleFromText({
          providerName: "groq",
          baseUrl: env.ai.groq.baseUrl,
          apiKey: env.ai.groq.apiKey,
          model: env.ai.groq.model,
          docType,
          rawText,
          signal
        })
    },
    {
      name: "openrouter",
      enabled: (requestedProvider === "openrouter" || (!explicitProviderSelected && useFallbacks)) && Boolean(env.ai.openrouter.apiKey),
      execute: async () => {
        const modelCandidates = [
          env.ai.openrouter.model,
          env.ai.openrouter.model.endsWith(":free") ? env.ai.openrouter.model.replace(/:free$/, "") : ""
        ].filter(Boolean);

        let lastError = null;

        for (const candidateModel of modelCandidates) {
          try {
            return await extractWithOpenAICompatibleFromText({
              providerName: "openrouter",
              baseUrl: env.ai.openrouter.baseUrl,
              apiKey: env.ai.openrouter.apiKey,
              model: candidateModel,
              docType,
              rawText
            });
          } catch (error) {
            lastError = error;

            if (!/status\s+404|no endpoints found/i.test(error.message)) {
              throw error;
            }
          }
        }

        throw lastError;
      }
    }
  ].filter((provider) => provider.enabled);

  const shouldFastAbort = fastModeEnabled;
  const isAbortLike = (error) => error?.name === "AbortError" || /budget exceeded|cancelled by user|timed out/i.test(error?.message || "");

  const selectedModel = (env.ai.ollama.model || "").toLowerCase();
  const isVisionCapableModel = /vision|vl|llava|moondream|gemma4/i.test(selectedModel);

  const isPdfForLocalVision =
    requestedProvider === "ollama" &&
    Boolean(filePath) &&
    detectMimeTypeFromFilePath(filePath) === "application/pdf" &&
    (isVisionCapableModel || !rawText || rawText.trim().length < 20); 

  if (isPdfForLocalVision) {
    try {
      emitProgressText(onProgressText, `Preparing PDF pages for local ${isVisionCapableModel ? "Vision AI" : "OCR fallback"} processing...`);
      const localVisionResult = await extractWithOllamaFromPdf({
        docType,
        filePath,
        pageCount,
        signal,
        onProgressText
      });
      if (localVisionResult?.events?.length > 0 || Object.keys(localVisionResult?.structured?.sections || {}).some((k) => localVisionResult.structured.sections[k]?.length > 0)) {
        return withRequestedProviderTag(localVisionResult);
      }
      providerErrors.push("ollama (pdf-images): No events extracted");
    } catch (error) {
      providerErrors.push(`ollama (pdf-images): ${error.message}`);
      console.error("[Ollama Vision] Error during PDF image processing:", error);
      if (shouldFastAbort && isAbortLike(error)) {
        return withRequestedProviderTag(
          buildProviderFallbackResult({
            provider: requestedProvider || "ollama",
            docType,
            rawText,
            structuredData,
            localFallbackResult,
            providerErrors,
            message: "Local AI exceeded the fast-mode budget. Returning local fallback output."
          })
        );
      }
    }
  }

  if (rawText && rawText.trim().length > 0 && textProviders.length > 0) {
    for (const provider of textProviders) {
      try {
        const result = await provider.execute();
        if (result?.events?.length > 0 || Object.keys(result?.structured?.sections || {}).some(k => result.structured.sections[k]?.length > 0)) {
          return withRequestedProviderTag(result);
        }
        providerErrors.push(`${provider.name}: No events extracted`);
      } catch (error) {
        providerErrors.push(`${provider.name}: ${error.message}`);
        if (shouldFastAbort && isAbortLike(error)) {
          return withRequestedProviderTag(
            buildProviderFallbackResult({
              provider: requestedProvider || provider.name,
              docType,
              rawText,
              structuredData,
              localFallbackResult,
              providerErrors,
              message: "Cloud AI exceeded the fast-mode budget. Returning local fallback output."
            })
          );
        }
      }
    }
  }

  // AI-first logic failed or returned empty results -> fallback to local hybrid heuristics
  const localResult = extractLocalEvents({ docType, rawText, structuredData });
  if (localResult.events.length > 0) {
    return withRequestedProviderTag({
       ...localResult,
       warnings: [
         ...(localResult.warnings || []), 
         "AI extraction failed or returned no events. Using heuristic fallback.",
         `Errors from AI providers during attempt: ${providerErrors.join(" | ")}`
       ]
    });
  }

  // Fallback: If no text and we have PDF file, try AI-powered PDF extraction
  if ((!rawText || rawText.trim().length === 0) && filePath) {
    const fileProviders = [
      {
        name: "ollama",
        enabled: requestedProvider === "ollama",
        execute: () => extractWithOllamaFromPdf({ docType, filePath, pageCount, signal, onProgressText })
      },
      {
        name: "gemini",
        enabled: requestedProvider === "gemini" || requestedProvider === "azure_vision" || (!explicitProviderSelected && Boolean(env.ai.gemini.apiKey)),
        execute: () => extractWithGeminiFromFile({ docType, filePath, pageCount })
      }
    ].filter((p) => p.enabled);

    for (const providerCandidate of fileProviders) {
      try {
        const result = await providerCandidate.execute();
        return withRequestedProviderTag(result);
      } catch (error) {
        providerErrors.push(`${providerCandidate.name} (file): ${error.message.slice(0, 200)}`);
        if (shouldFastAbort && isAbortLike(error)) {
          return withRequestedProviderTag(
            buildProviderFallbackResult({
              provider: requestedProvider || providerCandidate.name,
              docType,
              rawText,
              structuredData,
              localFallbackResult,
              providerErrors,
              message: "Cloud AI exceeded the fast-mode budget. Returning local fallback output."
            })
          );
        }
      }
    }

    // If PDF extraction was attempted but failed
    if (providerErrors.length > 0) {
      const hasOllamaSelected = requestedProvider === "ollama";
      return withRequestedProviderTag({
        provider: "stub",
        model: getProviderModel(hasOllamaSelected ? "ollama" : "gemini"),
        confidenceScore: 0.05,
        structured: docType === "exam_timetable" ? buildStructuredTimetable({ rawText, structuredData, events: [] }) : buildStructuredFromEvents(docType, []),
        warnings: [
          "PDF text extraction failed.",
          `AI extraction attempted: ${providerErrors.join(" | ")}`,
          hasOllamaSelected
            ? "This document may be a scanned image. Local Ollama image extraction failed after PDF conversion."
            : "This document may be a scanned image. Ensure GEMINI_API_KEY is valid for image extraction."
        ],
        events: []
      });
    }
  }

  if (!rawText || rawText.trim().length === 0) {
    const hasOllamaSelected = requestedProvider === "ollama";
    return withRequestedProviderTag({
      provider: "stub",
      model: getProviderModel(hasOllamaSelected ? "ollama" : "gemini"),
      confidenceScore: 0,
      structured: docType === "exam_timetable" ? buildStructuredTimetable({ rawText, structuredData, events: [] }) : buildStructuredFromEvents(docType, []),
      warnings: [
        "No text extracted from document parser",
        "This is typically a scanned PDF or image without searchable text.",
        hasOllamaSelected
          ? "Local Ollama was selected. If extraction still fails, the converted page images may be too large or too noisy for the model."
          : env.ai.gemini.apiKey
            ? "Gemini API key is configured. If extraction still fails, the API may be rate-limited or the document quality is too poor."
            : "No GEMINI_API_KEY configured. Configure it for scanned PDF extraction.",
        ...(providerErrors.length ? [`Provider errors: ${providerErrors.join(" | ")}`] : [])
      ],
      events: []
    });
  }

  // Fallback deterministic extraction for exam_timetable (or when Gemini unavailable)
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let candidateLines = [];
  if (docType === "exam_timetable") {
    candidateLines = lines.filter((line) => /exam|subject|paper|date|time|room|venue/i.test(line)).slice(0, 20);
  } else if (docType === "circular") {
    candidateLines = lines.filter((line) => /deadline|form|link|fee|important|notice|submit/i.test(line)).slice(0, 20);
  } else {
    candidateLines = lines.slice(0, 20);
  }

  const events = candidateLines.map((line, index) =>
    normalizeEvent(
      {
        subjectName: line,
        confidence: 0.4
      },
      index
    )
  );

  return withRequestedProviderTag({
    provider: "stub",
    model: env.ai.gemini.model,
    confidenceScore: events.length > 0 ? 0.4 : 0.15,
    structured: docType === "exam_timetable" ? buildStructuredTimetable({ rawText, structuredData, events }) : buildStructuredFromEvents(docType, events),
    warnings: [
      ...(providerErrors.length ? [`Text provider errors: ${providerErrors.join(" | ")}`] : []),
      ...(events.length > 0 ? [] : [`No ${docType} patterns detected in text`])
    ],
    events
  });
}

module.exports = { extractStructuredData };

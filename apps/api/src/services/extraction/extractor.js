const env = require("../../config/env");
const fs = require("fs/promises");

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
      subjectName: source.subjectName || source.subject || source.title || "",
      instructions: source.instructions || source.action || source.note || "",
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

async function extractWithOpenAICompatibleFromText({ providerName, baseUrl, apiKey, model, docType, rawText }) {
  const prompt = buildExtractionPrompt(docType);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.ai.timeoutMs);

  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

  try {
    const response = await fetch(`${normalizedBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      signal: controller.signal,
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

async function runGeminiWithFallbacks({ body, docType, emptyWarning }) {
  const modelCandidates = getGeminiModelCandidates();
  let lastError = null;

  for (const model of modelCandidates) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.ai.timeoutMs);

    try {
      const payload = await callGeminiGenerateContent({ model, body, signal: controller.signal });
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

async function extractWithGeminiFromText({ docType, rawText }) {
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
    emptyWarning: "Gemini extracted no events from the text"
  });
}

async function extractWithGeminiFromPdf({ docType, filePath, pageCount }) {
  const fileBuffer = await fs.readFile(filePath);
  const base64Pdf = fileBuffer.toString("base64");

  const prompt = buildExtractionPrompt(docType);

  return runGeminiWithFallbacks({
    body: {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "application/pdf",
                data: base64Pdf
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
    emptyWarning: "Gemini extracted no events from the uploaded PDF"
  });
}

async function extractStructuredData({ docType, rawText, filePath, pageCount, structuredData }) {
  const providerErrors = [];

  const localResult = extractLocalEvents({ docType, rawText, structuredData });
  if (localResult.events.length > 0) {
    return localResult;
  }

  const textProviders = [
    {
      name: "gemini",
      enabled: Boolean(env.ai.gemini.apiKey),
      execute: () => extractWithGeminiFromText({ docType, rawText })
    },
    {
      name: "groq",
      enabled: Boolean(env.ai.groq.apiKey),
      execute: () =>
        extractWithOpenAICompatibleFromText({
          providerName: "groq",
          baseUrl: env.ai.groq.baseUrl,
          apiKey: env.ai.groq.apiKey,
          model: env.ai.groq.model,
          docType,
          rawText
        })
    },
    {
      name: "openrouter",
      enabled: Boolean(env.ai.openrouter.apiKey),
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
  ]
    .filter((provider) => provider.enabled)
    .sort((a, b) => env.ai.providerOrder.indexOf(a.name) - env.ai.providerOrder.indexOf(b.name));

  if (rawText && rawText.trim().length > 0 && textProviders.length > 0) {
    for (const provider of textProviders) {
      try {
        return await provider.execute();
      } catch (error) {
        providerErrors.push(`${provider.name}: ${error.message}`);
      }
    }
  }

  // Fallback: If no text and we have PDF file, try AI-powered PDF extraction
  if ((!rawText || rawText.trim().length === 0) && filePath) {
    const pdfProviders = [
      {
        name: "gemini",
        enabled: Boolean(env.ai.gemini.apiKey),
        execute: () => extractWithGeminiFromPdf({ docType, filePath, pageCount })
      }
      // Note: Groq/OpenRouter cannot process PDF binary directly
    ]
      .filter((p) => p.enabled)
      .slice(0, 1);

    if (pdfProviders.length > 0) {
      for (const provider of pdfProviders) {
        try {
          const result = await provider.execute();
          return result;
        } catch (error) {
          providerErrors.push(`${provider.name} (PDF): ${error.message.slice(0, 200)}`);
        }
      }
    }

    // If PDF extraction was attempted but failed
    if (providerErrors.length > 0) {
      return {
        provider: "stub",
        model: env.ai.gemini.model,
        confidenceScore: 0.05,
        structured: docType === "exam_timetable" ? buildStructuredTimetable({ rawText, structuredData, events: [] }) : buildStructuredFromEvents(docType, []),
        warnings: [
          "PDF text extraction failed.",
          `AI extraction attempted: ${providerErrors.join(" | ")}`,
          "This document may be a scanned image. Ensure GEMINI_API_KEY is valid for image extraction."
        ],
        events: []
      };
    }
  }

  if (!rawText || rawText.trim().length === 0) {
    return {
      provider: "stub",
      model: env.ai.gemini.model,
      confidenceScore: 0,
      structured: docType === "exam_timetable" ? buildStructuredTimetable({ rawText, structuredData, events: [] }) : buildStructuredFromEvents(docType, []),
      warnings: [
        "No text extracted from document parser",
        "This is typically a scanned PDF or image without searchable text.",
        env.ai.gemini.apiKey
          ? "Gemini API key is configured. If extraction still fails, the API may be rate-limited or the document quality is too poor."
          : "No GEMINI_API_KEY configured. Configure it for scanned PDF extraction.",
        ...(providerErrors.length ? [`Provider errors: ${providerErrors.join(" | ")}`] : [])
      ],
      events: []
    };
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

  return {
    provider: "stub",
    model: env.ai.gemini.model,
    confidenceScore: events.length > 0 ? 0.4 : 0.15,
    structured: docType === "exam_timetable" ? buildStructuredTimetable({ rawText, structuredData, events }) : buildStructuredFromEvents(docType, events),
    warnings: [
      ...(providerErrors.length ? [`Text provider errors: ${providerErrors.join(" | ")}`] : []),
      ...(events.length > 0 ? [] : [`No ${docType} patterns detected in text`])
    ],
    events
  };
}

module.exports = { extractStructuredData };

const env = require("../../config/env");

function deriveEventFingerprint(item, index) {
  const subject = (item.subjectCode || item.subjectName || "UNKNOWN").replace(/\s+/g, "_").toUpperCase();
  const date = (item.date || "NO_DATE").replace(/\s+/g, "");
  return `${subject}_${date}_${index + 1}`;
}

async function extractStructuredData({ docType, rawText }) {
  // Stub for Phase 1: deterministic extraction until external AI API is integrated.
  if (!rawText || rawText.trim().length === 0) {
    return {
      provider: "stub",
      model: env.ai.model,
      confidenceScore: 0,
      warnings: ["No text extracted from document"],
      events: []
    };
  }

  if (docType !== "exam_timetable") {
    return {
      provider: "stub",
      model: env.ai.model,
      confidenceScore: 0.4,
      warnings: ["Document type extractor not implemented yet"],
      events: []
    };
  }

  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const examLines = lines.filter((line) => /exam|subject|paper|date/i.test(line)).slice(0, 20);

  const events = examLines.map((line, index) => ({
    eventId: deriveEventFingerprint({ subjectName: line }, index),
    date: "",
    startTime: "",
    endTime: "",
    subjectCode: "",
    subjectName: line,
    instructions: "",
    departments: [],
    years: [],
    sections: [],
    confidence: 0.35
  }));

  return {
    provider: "stub",
    model: env.ai.model,
    confidenceScore: events.length > 0 ? 0.35 : 0.15,
    warnings: ["Using bootstrap extractor. Integrate Gemini function-calling next."],
    events
  };
}

module.exports = { extractStructuredData };

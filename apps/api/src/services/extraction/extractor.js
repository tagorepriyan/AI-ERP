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

function processStructuredPage(page, docType) {
  const events = [];
  if (!page.rows || !Array.isArray(page.rows)) return events;

  for (const row of page.rows) {
    const date = row.date;
    const time = row.time || "";

    if (!row.exams || !Array.isArray(row.exams)) continue;

    for (const exam of row.exams) {
      // Parse subject name and code if possible
      let subjectName = exam.subject || "UNKNOWN";
      let subjectCode = exam.code || "";

      // Heuristic: If subject contains a 5-6 char alphanumeric code at start/end
      const codeMatch = subjectName.match(/\b([A-Z]{2,4}\s?\d{2,4}[A-Z]?)\b/);
      if (codeMatch && !subjectCode) {
        subjectCode = codeMatch[1];
        subjectName = subjectName.replace(codeMatch[1], "").trim();
      }

      const event = {
        date,
        startTime: time.split("-")[0]?.trim() || time,
        endTime: time.split("-")[1]?.trim() || "",
        subjectCode,
        subjectName,
        instructions: exam.department ? `Department: ${exam.department}` : "",
        departments: exam.department ? [exam.department] : [],
        years: [],
        sections: [],
        confidence: 0.85
      };

      events.push(normalizeEvent(event, events.length));
    }
  }
  return events;
}

function extractLocalEvents({ docType, rawText, structuredData }) {
  // If we have high-fidelity structured data from the Python OCR script, use it!
  if (structuredData && structuredData.structure_type === "grid_timetable") {
    const allEvents = [];
    for (const page of structuredData.pages || []) {
      allEvents.push(...processStructuredPage(page, docType));
    }
    if (allEvents.length > 0) {
      return buildLocalResult(allEvents);
    }
  }

  const normalizedRawText = normalizeTextValue(rawText);
  return buildLocalResult([]);
}

function buildLocalResult(events) {
  return buildResult({
    provider: "local-hybrid",
    model: "pdfplumber+easyocr+heuristics",
    events,
    emptyWarning: "Local hybrid extractor found no structured events"
  });
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
  const basePrompt =
    "You are an academic document extraction engine. Extract structured events and information relevant to students and faculty. Return a single JSON object and nothing else.";

  const typeSpecificInstructions = {
    exam_timetable: [
      basePrompt,
      "For exam schedules: extract exam name, subject code, subject name, date, time, venue/room, department(s), year(s), section(s).",
      "Each exam should be a separate event."
    ].join("\n"),

    circular: [
      basePrompt,
      "For administrative circulars: extract key deadlines, submission details, requirements, departments affected, and any linked actions.",
      "Important: include DATE, DEADLINE, ACTION REQUIRED, AFFECTED DEPARTMENT/YEAR/SECTION as separate event records.",
      "Each action item or deadline should be its own event."
    ].join("\n"),

    notice: [
      basePrompt,
      "For notices: extract announcements, important dates, actions required, departments/years/sections affected.",
      "Each significant notice item should be a separate event."
    ].join("\n")
  };

  return (
    (typeSpecificInstructions[docType] || basePrompt) +
    "\n" +
    "Return strict JSON with shape:\n" +
    '{"events":[{"date":"","startTime":"","endTime":"","subjectCode":"","subjectName":"","instructions":"","departments":[],"years":[],"sections":[],"confidence":0.8}]}' +
    "\nDo not wrap the JSON in markdown fences, comments, or extra text."
  );
}

function buildResult({ provider, model, events, emptyWarning }) {
  const confidenceScore =
    events.length > 0
      ? events.reduce((sum, event) => sum + event.confidence, 0) / events.length
      : 0.2;

  return {
    provider,
    model,
    confidenceScore,
    warnings: events.length ? [] : [emptyWarning],
    events
  };
}

function parseEventsFromModelText(text) {
  if (!text) {
    throw new Error("Model returned empty content");
  }

  const parsed = parseJsonPayload(text);
  const rawEvents = Array.isArray(parsed) ? parsed : Array.isArray(parsed.events) ? parsed.events : [];
  return rawEvents.map((item, index) => normalizeEvent(item, index));
}

function extractLocalEvents({ docType, rawText }) {
  const normalizedRawText = normalizeTextValue(rawText);

  if (!normalizedRawText) {
    return buildLocalResult([]);
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

  return buildLocalResult(events);
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
    const events = parseEventsFromModelText(content);

    return buildResult({
      provider: providerName,
      model,
      events,
      emptyWarning: `${providerName} extracted no events from the text`
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function extractWithGeminiFromText({ docType, rawText }) {
  const prompt = buildExtractionPrompt(docType);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.ai.timeoutMs);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${env.ai.gemini.model}:generateContent?key=${env.ai.gemini.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt + "\n\nDocument content:\n" + rawText }
              ]
            }
          ],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0
          }
        })
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      const errorMessage = errorBody
        ? `Gemini request failed with status ${response.status}: ${errorBody.slice(0, 500)}`
        : `Gemini request failed with status ${response.status}`;
      throw new Error(errorMessage);
    }

    const payload = await response.json();
    const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    const events = parseEventsFromModelText(text);

    return buildResult({
      provider: "gemini",
      model: env.ai.gemini.model,
      events,
      emptyWarning: "Gemini extracted no events from the text"
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function extractWithGeminiFromPdf({ docType, filePath, pageCount }) {
  const fileBuffer = await fs.readFile(filePath);
  const base64Pdf = fileBuffer.toString("base64");

  const prompt = buildExtractionPrompt(docType);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.ai.timeoutMs);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${env.ai.gemini.model}:generateContent?key=${env.ai.gemini.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
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
            responseMimeType: "application/json",
            temperature: 0
          }
        })
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      const errorMessage = errorBody
        ? `Gemini request failed with status ${response.status}: ${errorBody.slice(0, 500)}`
        : `Gemini request failed with status ${response.status}`;
      throw new Error(errorMessage);
    }

    const payload = await response.json();
    const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    const events = parseEventsFromModelText(text);

    return buildResult({
      provider: "gemini",
      model: env.ai.gemini.model,
      events,
      emptyWarning: "Gemini extracted no events from the uploaded PDF"
    });
  } finally {
    clearTimeout(timeout);
  }
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
    warnings: [
      ...(providerErrors.length ? [`Text provider errors: ${providerErrors.join(" | ")}`] : []),
      ...(events.length > 0 ? [] : [`No ${docType} patterns detected in text`])
    ],
    events
  };
}

module.exports = { extractStructuredData };

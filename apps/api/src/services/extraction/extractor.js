const env = require("../../config/env");
const fs = require("fs/promises");

function deriveEventFingerprint(item, index) {
  const subject = (item.subjectCode || item.subjectName || "UNKNOWN").replace(/\s+/g, "_").toUpperCase();
  const date = (item.date || "NO_DATE").replace(/\s+/g, "");
  return `${subject}_${date}_${index + 1}`;
}

function normalizeEvent(item, index) {
  return {
    eventId: item.eventId || deriveEventFingerprint(item, index),
    date: item.date || "",
    startTime: item.startTime || "",
    endTime: item.endTime || "",
    subjectCode: item.subjectCode || "",
    subjectName: item.subjectName || "",
    instructions: item.instructions || "",
    departments: Array.isArray(item.departments) ? item.departments : [],
    years: Array.isArray(item.years) ? item.years : [],
    sections: Array.isArray(item.sections) ? item.sections : [],
    confidence: Number.isFinite(item.confidence) ? item.confidence : 0.5
  };
}

function parseJsonPayload(text) {
  const clean = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(clean);
}

function buildExtractionPrompt(docType) {
  const basePrompt =
    "You are an academic document extraction engine. Extract structured events and information relevant to students and faculty.";

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
    '{"events":[{"date":"","startTime":"","endTime":"","subjectCode":"","subjectName":"","instructions":"","departments":[],"years":[],"sections":[],"confidence":0.8}]}'
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
  const rawEvents = Array.isArray(parsed.events) ? parsed.events : [];
  return rawEvents.map((item, index) => normalizeEvent(item, index));
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
        temperature: 0.1,
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
            responseMimeType: "application/json"
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
            responseMimeType: "application/json"
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

async function extractStructuredData({ docType, rawText, filePath, pageCount }) {
  const providerErrors = [];

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
      execute: () =>
        extractWithOpenAICompatibleFromText({
          providerName: "openrouter",
          baseUrl: env.ai.openrouter.baseUrl,
          apiKey: env.ai.openrouter.apiKey,
          model: env.ai.openrouter.model,
          docType,
          rawText
        })
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

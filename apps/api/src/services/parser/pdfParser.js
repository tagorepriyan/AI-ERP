const fs = require("fs/promises");
const { execFile } = require("child_process");
const path = require("path");
const util = require("util");
const pdf = require("pdf-parse");
const env = require("../../config/env");

const execFilePromise = util.promisify(execFile);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeAzureEndpoint(endpoint) {
  return (endpoint || "").trim().replace(/\/+$/, "");
}

async function runAzureReadOcr(filePath, signal) {
  const endpoint = normalizeAzureEndpoint(env.ai.azureVision.endpoint);
  const apiKey = env.ai.azureVision.apiKey;

  if (!endpoint || !apiKey) {
    throw new Error("Azure Vision endpoint/key are not configured");
  }

  const submitUrl = `${endpoint}/vision/v3.2/read/analyze`;
  const fileBuffer = await fs.readFile(filePath);

  const submitResponse = await fetch(submitUrl, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
      "Content-Type": "application/octet-stream"
    },
    body: fileBuffer,
    signal
  });

  if (!submitResponse.ok) {
    const body = await submitResponse.text();
    throw new Error(`Azure Vision submit failed (${submitResponse.status}): ${body.slice(0, 200)}`);
  }

  const operationLocation = submitResponse.headers.get("operation-location");
  if (!operationLocation) {
    throw new Error("Azure Vision did not return operation-location");
  }

  const startedAt = Date.now();
  const timeoutMs = env.ai.azureVision.timeoutMs;
  const pollIntervalMs = env.ai.azureVision.pollIntervalMs;

  while (Date.now() - startedAt < timeoutMs) {
    const pollResponse = await fetch(operationLocation, {
      method: "GET",
      headers: {
        "Ocp-Apim-Subscription-Key": apiKey
      },
      signal
    });

    if (!pollResponse.ok) {
      const body = await pollResponse.text();
      throw new Error(`Azure Vision poll failed (${pollResponse.status}): ${body.slice(0, 200)}`);
    }

    const payload = await pollResponse.json();
    const status = String(payload?.status || "").toLowerCase();

    if (status === "succeeded") {
      const readResults = payload?.analyzeResult?.readResults || [];
      const lines = readResults.flatMap((page) => page?.lines || []).map((line) => line?.text || "").filter(Boolean);
      return {
        rawText: lines.join("\n"),
        pageCount: readResults.length || 1
      };
    }

    if (status === "failed") {
      throw new Error("Azure Vision Read returned failed status");
    }

    await sleep(pollIntervalMs);
  }

  throw new Error("Azure Vision OCR timed out");
}

function parseHybridOutput(stdout) {
  const text = (stdout || "").trim();

  if (!text) {
    throw new Error("Hybrid OCR returned empty output");
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");

    if (start !== -1 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }

    throw new Error("Hybrid OCR output was not valid JSON");
  }
}

async function runPythonHybridParser(filePath, signal) {
  const pyScriptPath = path.join(__dirname, "../../../scripts/hybrid_ocr.py");
  const candidates = [
    process.env.PYTHON_EXECUTABLE
      ? { command: process.env.PYTHON_EXECUTABLE, args: [pyScriptPath, "--file", filePath] }
      : null,
    { command: "python", args: [pyScriptPath, "--file", filePath] },
    { command: "py", args: ["-3", pyScriptPath, "--file", filePath] }
  ].filter(Boolean);

  let lastError = null;

  for (const candidate of candidates) {
    try {
      const { stdout } = await execFilePromise(candidate.command, candidate.args, {
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
        signal
      });
      return parseHybridOutput(stdout);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Unable to execute Python hybrid OCR script");
}

async function parsePdf(filePath, signal, skipHybridOcr = false, bypassPdfParse = false, provider = "gemini") {
  const ext = path.extname(filePath || "").toLowerCase();

  const textExtensions = new Set([".txt", ".md", ".csv", ".json", ".log", ".xml", ".yaml", ".yml"]);
  const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"]);

  if (textExtensions.has(ext)) {
    try {
      const rawText = await fs.readFile(filePath, "utf8");
      return {
        rawText: rawText || "",
        pageCount: 1
      };
    } catch (_error) {
      return {
        rawText: "",
        pageCount: 1
      };
    }
  }

  if (imageExtensions.has(ext)) {
    if (provider === "azure_vision") {
      try {
        return await runAzureReadOcr(filePath, signal);
      } catch (error) {
        console.warn(`[Azure Vision OCR failed for image] ${error.message}`);
      }
    }
    return {
      rawText: "",
      pageCount: 1
    };
  }

  if (bypassPdfParse) {
    console.log(`[pdfParser] Bypassing EVERYTHING as requested. Passing raw file path downstream.`);
    return { rawText: "", pageCount: 0 };
  }

  if (skipHybridOcr) {
    console.log(`[pdfParser] Skipping hybrid OCR as requested. Falling back to pure Node pdf-parse.`);
    return await fallbackParse(filePath);
  }

  if (provider === "azure_vision") {
    try {
      return await runAzureReadOcr(filePath, signal);
    } catch (error) {
      console.warn(`[Azure Vision OCR failed] ${error.message}. Falling back to local parsing...`);
    }
  }

  try {
    const result = await runPythonHybridParser(filePath, signal);

    if (result?.error) {
      console.warn(`[Python OCR Error] ${result.error}. Falling back to node pdf-parse.`);
      return await fallbackParse(filePath);
    }

    const pageRawText = Array.isArray(result.pages)
      ? result.pages
          .map((page) => (page && typeof page.rawText === "string" ? page.rawText : ""))
          .join("\n")
          .trim()
      : "";

    const rawText = (typeof result.rawText === "string" ? result.rawText : pageRawText) || "";

    return {
      rawText,
      pageCount: result.pages ? result.pages.length : (result.pageCount || 0),
      structuredData: result // Pass the whole object (structure_type: 'grid_timetable')
    };
  } catch (error) {
    console.error(`[Python hybrid parser failed]`, error.message);
    console.warn("Falling back to pure Node pdf-parse...");
    return await fallbackParse(filePath);
  }
}

async function fallbackParse(filePath) {
  try {
    const buffer = await fs.readFile(filePath);
    const result = await pdf(buffer);
    return {
      rawText: result.text || "",
      pageCount: result.numpages || 0
    };
  } catch (_error) {
    return {
      rawText: "",
      pageCount: 0
    };
  }
}

module.exports = { parsePdf };

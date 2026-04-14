const fs = require("fs/promises");
const { execFile } = require("child_process");
const path = require("path");
const util = require("util");
const pdf = require("pdf-parse");

const execFilePromise = util.promisify(execFile);

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

async function parsePdf(filePath, signal, skipHybridOcr = false) {
  if (skipHybridOcr) {
    console.log(`[pdfParser] Skipping hybrid OCR as requested. Falling back to pure Node pdf-parse.`);
    return await fallbackParse(filePath);
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

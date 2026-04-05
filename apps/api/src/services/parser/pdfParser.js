const fs = require("fs/promises");
const { exec } = require("child_process");
const path = require("path");
const util = require("util");
const execPromise = util.promisify(exec);
const pdf = require("pdf-parse");

async function parsePdf(filePath) {
  try {
    // Determine the path to our hybrid python script
    const pyScriptPath = path.join(__dirname, "../../../scripts/hybrid_ocr.py");
    
    // Command to run python. Using 'python' - you may need 'python3' based on environment
    // Quoting the filePath to handle spaces
    const { stdout, stderr } = await execPromise(`python "${pyScriptPath}" --file "${filePath}"`);
    
    const result = JSON.parse(stdout);
    
    if (result.error) {
      console.warn(`[Python OCR Error] ${result.error}. Falling back to node pdf-parse.`);
      return await fallbackParse(filePath);
    }

    return {
      rawText: result.rawText || "",
      pageCount: result.pageCount || 0
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

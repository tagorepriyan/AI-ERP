const fs = require("fs/promises");
const pdf = require("pdf-parse");

async function parsePdf(filePath) {
  const buffer = await fs.readFile(filePath);

  try {
    const result = await pdf(buffer);
    return {
      rawText: result.text || "",
      pageCount: result.numpages || 0
    };
  } catch (_error) {
    // Fail-soft strategy: preserve workflow while parser hardening continues.
    return {
      rawText: "",
      pageCount: 0
    };
  }
}

module.exports = { parsePdf };

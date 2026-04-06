const crypto = require("crypto");

const Document = require("../../models/Document");
const DocumentVersion = require("../../models/DocumentVersion");
const { parsePdf } = require("../parser/pdfParser");
const { extractStructuredData } = require("../extraction/extractor");

function sha1(text) {
  return crypto.createHash("sha1").update(text).digest("hex");
}

async function processUploadedDocument({
  tenantId,
  title,
  docType,
  file,
  uploadedBy = "admin"
}) {
  const parserResult = await parsePdf(file.path);
  const checksum = sha1(`${file.originalname}:${file.size}:${parserResult.rawText.slice(0, 2000)}`);

  const document = await Document.create({
    tenantId,
    title,
    docType,
    sourceFileName: file.originalname,
    storagePath: file.path,
    checksum,
    status: "processing",
    uploadedBy
  });

  try {
    const extraction = await extractStructuredData({
      docType,
      rawText: parserResult.rawText,
      filePath: file.path,
      pageCount: parserResult.pageCount,
      structuredData: parserResult.structuredData // Pass the grid-based data
    });

    const version = await DocumentVersion.create({
      tenantId,
      documentId: document._id,
      versionNumber: 1,
      parserOutput: {
        rawTextLength: parserResult.rawText.length,
        pageCount: parserResult.pageCount
      },
      extraction: {
        provider: extraction.provider,
        model: extraction.model,
        status: "completed",
        confidenceScore: extraction.confidenceScore,
        warnings: extraction.warnings,
        events: extraction.events,
        structured: extraction.structured
      }
    });

    document.status = extraction.confidenceScore >= 0.7 ? "published" : "review_required";
    await document.save();

    return {
      document,
      version,
      nextAction: document.status === "published" ? "ready_for_notifications" : "admin_review_required"
    };
  } catch (error) {
    document.status = "failed";
    await document.save();
    throw error;
  }
}

module.exports = { processUploadedDocument };

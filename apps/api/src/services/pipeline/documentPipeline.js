const crypto = require("crypto");

const Document = require("../../models/Document");
const DocumentVersion = require("../../models/DocumentVersion");
const NotificationLog = require("../../models/NotificationLog");
const { parsePdf } = require("../parser/pdfParser");
const { extractStructuredData } = require("../extraction/extractor");
const { deriveRecipients } = require("../routing/routingEngine");
const { updateJob, getJobSignal } = require("../jobs/jobStore");

function sha1(text) {
  return crypto.createHash("sha1").update(text).digest("hex");
}

async function processUploadedDocument({
  tenantId,
  title,
  docType,
  file,
  provider,
  uploadedBy = "admin",
  jobId = null,
  workflowSettings = {}
}) {
  const emit = (stage, label) => { if (jobId) updateJob(jobId, stage, label); };
  const signal = jobId ? getJobSignal(jobId) : undefined;

  emit("parse", "Extracting text and structure...");
  const skipHybridOcr = workflowSettings.skipHybridOcr === true;
  const bypassPdfParse = workflowSettings.bypassPdfParse === true;
  const parserResult = await parsePdf(file.path, signal, skipHybridOcr, bypassPdfParse, provider);
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
    emit("ocr", "Extracting text content...");
    // (OCR already done inside parsePdf — this is a stage label update)

    emit("ai", `Sending to AI model (${provider === "ollama" ? "Local Mistral" : "Cloud"})...`);
    const extraction = await extractStructuredData({
      docType,
      rawText: parserResult.rawText,
      filePath: file.path,
      pageCount: parserResult.pageCount,
      provider,
      structuredData: parserResult.structuredData,
      settings: workflowSettings
    });

    emit("routing", "Running intelligent routing engine...");
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

    // Always hold at pending_approval — admin must approve before delivery
    document.status = "pending_approval";
    await document.save();

    // ── Intelligent Routing ──────────────────────────────────────────────────
    let routingResult = { recipients: [], conditionLabels: [], matchQuery: {} };
    try {
      routingResult = await deriveRecipients(tenantId, extraction);

      if (routingResult.recipients.length > 0) {
        const logDocs = routingResult.recipients.map((user) => ({
          tenantId,
          documentId: document._id,
          documentTitle: document.title,
          documentType: docType,
          userId: user._id?.toString() || user.registrationNo || user.userId,
          userFullName: user.fullName,
          userRole: user.role || "student",
          userDepartment: user.department || "",
          userYear: user.year || "",
          matchedConditions: routingResult.conditionLabels,
          channels: {
            inApp: { sent: false },
            email: { sent: false },
            sms: { sent: false }
          },
          status: "pending" // Held until admin approves
        }));

        await NotificationLog.insertMany(logDocs, { ordered: false }).catch(() => {});
      }
    } catch (routeErr) {
      console.error("[routing] Failed to derive recipients:", routeErr.message);
    }
    // ─────────────────────────────────────────────────────────────────────────

    emit("saving", "Saving results to database...");

    return {
      document,
      version,
      routingResult,
      nextAction: "pending_admin_approval"
    };
  } catch (error) {
    if (error.name === "AbortError" || error.message.includes("Cancelled by user")) {
      console.log(`[documentPipeline] Job ${jobId} was cancelled by user.`);
      document.status = "failed";
      // We don't save the document if cancelled before taking action, or we save it as cancelled.
      // Saving it as failed is fine.
    } else {
      document.status = "failed";
    }
    await document.save();
    throw error;
  }
}

module.exports = { processUploadedDocument };

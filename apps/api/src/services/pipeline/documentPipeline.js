const crypto = require("crypto");

const Document = require("../../models/Document");
const DocumentVersion = require("../../models/DocumentVersion");
const NotificationLog = require("../../models/NotificationLog");
const { parsePdf } = require("../parser/pdfParser");
const { extractStructuredData } = require("../extraction/extractor");
const { deriveRecipients } = require("../routing/routingEngine");
const { updateJob, updateJobLiveText, getJobSignal } = require("../jobs/jobStore");
const env = require("../../config/env");

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
  const emitLiveText = (text) => { if (jobId) updateJobLiveText(jobId, text); };
  const signal = jobId ? getJobSignal(jobId) : undefined;
  const fastMode = workflowSettings.fastMode !== false;
  const budgetMs = workflowSettings.processingBudgetMs || env.ai.fastModeBudgetMs;
  const budgetController = fastMode && budgetMs > 0 ? new AbortController() : null;
  const mergedSignal = (() => {
    if (!signal && !budgetController) return undefined;
    const controller = new AbortController();
    const forwardAbort = (sourceSignal) => {
      if (!sourceSignal) return;
      if (sourceSignal.aborted) {
        controller.abort(sourceSignal.reason);
        return;
      }
      sourceSignal.addEventListener("abort", () => controller.abort(sourceSignal.reason), { once: true });
    };
    forwardAbort(signal);
    forwardAbort(budgetController?.signal);
    return controller.signal;
  })();

  let budgetTimer = null;
  if (budgetController) {
    budgetTimer = setTimeout(() => budgetController.abort(new Error("Fast mode processing budget exceeded")), budgetMs);
  }

  let document = null;
  let parserResult = null;

  try {
    emit("parse", "Extracting text and structure...");
    const skipHybridOcr = workflowSettings.skipHybridOcr === true;
    const bypassPdfParse = workflowSettings.bypassPdfParse === true;
    parserResult = await parsePdf(file.path, mergedSignal, skipHybridOcr, bypassPdfParse, provider, fastMode);
    const checksum = sha1(`${file.originalname}:${file.size}:${parserResult.rawText.slice(0, 2000)}`);

    document = await Document.create({
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

      emit("ai", `Sending to AI model (${provider === "ollama" ? `Local ${env.ai.ollama.model}` : "Cloud"})...`);
      const extraction = await extractStructuredData({
        docType,
        rawText: parserResult.rawText,
        filePath: file.path,
        pageCount: parserResult.pageCount,
        provider,
        structuredData: parserResult.structuredData,
        settings: workflowSettings,
        signal: mergedSignal,
        onProgressText: emitLiveText
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
        if (document) {
          document.status = "failed";
          await document.save();
        }
      } else {
        if (document) {
          document.status = "failed";
          await document.save();
        }
      }
      throw error;
    }
  } catch (error) {
    if (error.name === "AbortError" || error.message.includes("Cancelled by user")) {
      console.log(`[documentPipeline] Job ${jobId} was cancelled by user.`);
    } else {
      console.error("[documentPipeline] Failed to process uploaded document:", error);
    }
    throw error;
  } finally {
    if (budgetTimer) {
      clearTimeout(budgetTimer);
    }
  }
}

module.exports = { processUploadedDocument };

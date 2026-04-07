const path = require("path");
const crypto = require("crypto");

const express = require("express");
const multer = require("multer");

const env = require("../config/env");
const Document = require("../models/Document");
const DocumentVersion = require("../models/DocumentVersion");
const NotificationLog = require("../models/NotificationLog");
const { processUploadedDocument } = require("../services/pipeline/documentPipeline");
const { extractStructuredData } = require("../services/extraction/extractor");
const { deriveRecipients } = require("../services/routing/routingEngine");
const { createJob, updateJob, failJob, completeJob } = require("../services/jobs/jobStore");

const router = express.Router();

const upload = multer({
  dest: path.resolve(process.cwd(), env.uploadDir),
  limits: { fileSize: 20 * 1024 * 1024 }
});

// ── POST /documents/upload ─────────────────────────────────────────────────────
router.post("/upload", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: { message: "file is required" } });
    }

    const jobId = crypto.randomBytes(8).toString("hex");
    const title = req.body.title || req.file.originalname;
    const docType = req.body.docType || "exam_timetable";
    const requestedProvider = req.body.provider || "ollama";

    // Return jobId immediately so frontend can start polling
    res.status(202).json({ jobId, message: "Processing started" });

    // Process asynchronously
    createJob(jobId);

    try {
      updateJob(jobId, "parse", "Parsing PDF structure...");
      const result = await processUploadedDocument({
        tenantId: req.tenantId,
        title,
        docType,
        provider: requestedProvider,
        file: req.file,
        uploadedBy: req.body.uploadedBy || "admin",
        jobId
      });

      completeJob(jobId, result.routingResult?.recipients?.length ?? 0);
    } catch (err) {
      failJob(jobId, err.message || "Unknown error");
      console.error("[upload] Pipeline error:", err);
    }
  } catch (error) {
    return next(error);
  }
});

// ── GET /documents ─────────────────────────────────────────────────────────────
router.get("/", async (req, res, next) => {
  try {
    const { status } = req.query;
    const filter = { tenantId: req.tenantId };
    if (status) filter.status = status;

    const docs = await Document.find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const items = await Promise.all(docs.map(async (doc) => {
      const latestVersion = await DocumentVersion.findOne({
        tenantId: req.tenantId,
        documentId: doc._id,
        versionNumber: doc.latestVersion
      }).select("extraction.provider extraction.confidenceScore").lean();

      const recipientCount = await NotificationLog.countDocuments({
        tenantId: req.tenantId,
        documentId: doc._id
      });

      return {
        id: doc._id,
        title: doc.title,
        docType: doc.docType,
        status: doc.status,
        createdAt: doc.createdAt,
        approvedAt: doc.approvedAt,
        approvedBy: doc.approvedBy,
        rejectionReason: doc.rejectionReason,
        provider: latestVersion?.extraction?.provider || "unknown",
        confidenceScore: latestVersion?.extraction?.confidenceScore || 0,
        recipientCount
      };
    }));

    res.json({ items });
  } catch (error) {
    next(error);
  }
});

// ── GET /documents/:id ─────────────────────────────────────────────────────────
router.get("/:id", async (req, res, next) => {
  try {
    const doc = await Document.findOne({ _id: req.params.id, tenantId: req.tenantId }).lean();
    if (!doc) return res.status(404).json({ error: { message: "Document not found" } });

    const latestVersion = await DocumentVersion.findOne({
      tenantId: req.tenantId,
      documentId: doc._id,
      versionNumber: doc.latestVersion
    }).lean();

    const recipientCount = await NotificationLog.countDocuments({
      tenantId: req.tenantId,
      documentId: doc._id
    });

    return res.json({
      document: {
        id: doc._id,
        title: doc.title,
        docType: doc.docType,
        status: doc.status,
        sourceFileName: doc.sourceFileName,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        approvedBy: doc.approvedBy,
        approvedAt: doc.approvedAt,
        rejectionReason: doc.rejectionReason
      },
      recipientCount,
      latestVersion: latestVersion ? {
        versionNumber: latestVersion.versionNumber,
        parserOutput: latestVersion.parserOutput,
        extraction: latestVersion.extraction
      } : null
    });
  } catch (error) {
    return next(error);
  }
});

// ── POST /documents/:id/approve ────────────────────────────────────────────────
router.post("/:id/approve", async (req, res, next) => {
  try {
    const { approvedBy = "admin" } = req.body;
    const doc = await Document.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!doc) return res.status(404).json({ error: { message: "Document not found" } });

    doc.status = "published";
    doc.approvedBy = approvedBy;
    doc.approvedAt = new Date();
    await doc.save();

    // Mark all pending notifications for this doc as delivered
    const now = new Date();
    const updateResult = await NotificationLog.updateMany(
      { tenantId: req.tenantId, documentId: doc._id, status: "pending" },
      {
        $set: {
          status: "delivered",
          approvedBy,
          approvedAt: now,
          "channels.inApp.sent": true,
          "channels.inApp.sentAt": now
        }
      }
    );

    res.json({
      success: true,
      document: { id: doc._id, status: doc.status },
      notificationsDelivered: updateResult.modifiedCount
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /documents/:id/reject ─────────────────────────────────────────────────
router.post("/:id/reject", async (req, res, next) => {
  try {
    const { reason = "Rejected by admin", rejectedBy = "admin" } = req.body;
    const doc = await Document.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!doc) return res.status(404).json({ error: { message: "Document not found" } });

    doc.status = "rejected";
    doc.rejectedBy = rejectedBy;
    doc.rejectedAt = new Date();
    doc.rejectionReason = reason;
    await doc.save();

    // Clear all pending notification logs
    await NotificationLog.updateMany(
      { tenantId: req.tenantId, documentId: doc._id, status: "pending" },
      { $set: { status: "skipped" } }
    );

    res.json({ success: true, document: { id: doc._id, status: doc.status } });
  } catch (err) {
    next(err);
  }
});

// ── POST /documents/:id/reprocess ──────────────────────────────────────────────
router.post("/:id/reprocess", async (req, res, next) => {
  try {
    const doc = await Document.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!doc) return res.status(404).json({ error: { message: "Document not found" } });

    const latestVersion = await DocumentVersion.findOne({
      tenantId: req.tenantId,
      documentId: doc._id,
      versionNumber: doc.latestVersion
    });
    if (!latestVersion) return res.status(404).json({ error: { message: "Document version not found" } });

    const rawText = latestVersion.parserOutput.rawText;
    const provider = req.body.provider || "ollama";

    doc.status = "processing";
    await doc.save();

    const extractionResult = await extractStructuredData({
      docType: doc.docType,
      rawText,
      filePath: latestVersion.parserOutput.filePath,
      pageCount: latestVersion.parserOutput.pageCount,
      provider,
      structuredData: latestVersion.parserOutput.structuredData
    });

    latestVersion.extraction = extractionResult;
    await latestVersion.save();

    // Re-derive recipients
    const routingResult = await deriveRecipients(req.tenantId, extractionResult).catch(() => ({ recipients: [], conditionLabels: [] }));

    // Clear old pending logs and re-create
    await NotificationLog.deleteMany({ tenantId: req.tenantId, documentId: doc._id, status: "pending" });
    if (routingResult.recipients.length > 0) {
      const logDocs = routingResult.recipients.map(u => ({
        tenantId: req.tenantId,
        documentId: doc._id,
        documentTitle: doc.title,
        documentType: doc.docType,
        userId: u._id?.toString() || u.registrationNo,
        userFullName: u.fullName,
        userRole: u.role || "student",
        userDepartment: u.department,
        userYear: u.year,
        matchedConditions: routingResult.conditionLabels,
        status: "pending"
      }));
      await NotificationLog.insertMany(logDocs, { ordered: false }).catch(() => {});
    }

    doc.status = "pending_approval";
    await doc.save();

    res.json({ success: true, extraction: extractionResult, recipientCount: routingResult.recipients.length });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

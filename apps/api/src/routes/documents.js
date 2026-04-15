const path = require("path");
const crypto = require("crypto");
const fs = require("fs");

const express = require("express");
const multer = require("multer");

const env = require("../config/env");
const Document = require("../models/Document");
const DocumentVersion = require("../models/DocumentVersion");
const NotificationLog = require("../models/NotificationLog");
const { processUploadedDocument } = require("../services/pipeline/documentPipeline");
const { parsePdf } = require("../services/parser/pdfParser");
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
    
    let workflowSettings = {};
    try {
      if (req.body.settings) workflowSettings = JSON.parse(req.body.settings);
    } catch(e) {}

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
        workflowSettings,
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

// ── PATCH /documents/:id ─────────────────────────────────────────────────────
router.patch("/:id", async (req, res, next) => {
  try {
    const doc = await Document.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!doc) return res.status(404).json({ error: { message: "Document not found" } });

    const { title, docType } = req.body || {};
    const updates = {};

    if (typeof title === "string") {
      const normalizedTitle = title.trim();
      if (!normalizedTitle) {
        return res.status(400).json({ error: { message: "title cannot be empty" } });
      }
      updates.title = normalizedTitle;
    }

    if (typeof docType === "string") {
      const normalizedDocType = docType.trim();
      if (!normalizedDocType) {
        return res.status(400).json({ error: { message: "docType cannot be empty" } });
      }
      updates.docType = normalizedDocType;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: { message: "No valid update fields provided" } });
    }

    Object.assign(doc, updates);
    await doc.save();

    const logSet = {};
    if (updates.title) logSet.documentTitle = updates.title;
    if (updates.docType) {
      logSet.documentType = updates.docType;
      logSet.notificationType = updates.docType;
    }

    if (Object.keys(logSet).length > 0) {
      await NotificationLog.updateMany(
        { tenantId: req.tenantId, documentId: doc._id },
        { $set: logSet }
      );
    }

    res.json({
      success: true,
      document: {
        id: doc._id,
        title: doc.title,
        docType: doc.docType,
        status: doc.status,
        updatedAt: doc.updatedAt
      }
    });
  } catch (error) {
    next(error);
  }
});

// ── DELETE /documents/:id ────────────────────────────────────────────────────
router.delete("/:id", async (req, res, next) => {
  try {
    const doc = await Document.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!doc) return res.status(404).json({ error: { message: "Document not found" } });

    const filePath = doc.storagePath;
    const docId = doc._id;

    await DocumentVersion.deleteMany({ tenantId: req.tenantId, documentId: docId });
    await NotificationLog.deleteMany({ tenantId: req.tenantId, documentId: docId });
    await Document.deleteOne({ _id: docId, tenantId: req.tenantId });

    if (filePath) {
      fs.promises.unlink(filePath).catch((unlinkErr) => {
        if (unlinkErr?.code !== "ENOENT") {
          console.warn(`[documents] Failed to remove file ${filePath}: ${unlinkErr.message}`);
        }
      });
    }

    res.json({ success: true, id: docId });
  } catch (error) {
    next(error);
  }
});

// ── POST /documents/:id/approve ────────────────────────────────────────────────
router.post("/:id/approve", async (req, res, next) => {
  try {
    const {
      approvedBy = "admin",
      deliveryMode = "both",
      priority = "normal",
      content = "",
      scheduledAt = null,
      filters = null  // If admin refined targeting
    } = req.body;

    const doc = await Document.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!doc) return res.status(404).json({ error: { message: "Document not found" } });

    const now = new Date();
    const isScheduled = scheduledAt && new Date(scheduledAt) > now;

    doc.approvedBy = approvedBy;
    doc.approvedAt = now;
    doc.deliveryMode = deliveryMode;
    doc.priority = priority;
    if (content) doc.content = content;
    if (isScheduled) {
      doc.status = "scheduled";
      doc.scheduledAt = new Date(scheduledAt);
    } else {
      doc.status = "published";
    }

    // Save the approved filter snapshot
    if (filters) {
      doc.approvedFilters = filters;
    }

    await doc.save();

    // Update all pending notifications for this doc
    const updateFields = {
      approvedBy,
      approvedAt: now,
      deliveryMode,
      priority,
      notificationType: doc.docType
    };

    if (content) updateFields.content = content;

    if (isScheduled) {
      updateFields.status = "scheduled";
      updateFields.scheduledAt = new Date(scheduledAt);
    } else {
      updateFields.status = "delivered";
      updateFields.sentAt = now;
      updateFields["channels.inApp.sent"] = true;
      updateFields["channels.inApp.sentAt"] = now;
    }

    const updateResult = await NotificationLog.updateMany(
      { tenantId: req.tenantId, documentId: doc._id, status: "pending" },
      { $set: updateFields }
    );

    // If scheduled, set in-memory timer
    if (isScheduled) {
      const delay = new Date(scheduledAt).getTime() - Date.now();
      setTimeout(async () => {
        try {
          await NotificationLog.updateMany(
            { tenantId: req.tenantId, documentId: doc._id, status: "scheduled" },
            {
              $set: {
                status: "delivered",
                sentAt: new Date(),
                "channels.inApp.sent": true,
                "channels.inApp.sentAt": new Date()
              }
            }
          );
          await Document.updateOne({ _id: doc._id }, { $set: { status: "published" } });
          console.log(`[scheduler] Delivered scheduled notifications for doc ${doc._id}`);
        } catch (e) {
          console.error("[scheduler] Error:", e.message);
        }
      }, Math.max(delay, 1000));
    }

    res.json({
      success: true,
      document: { id: doc._id, status: doc.status, scheduledAt: doc.scheduledAt },
      notificationsUpdated: updateResult.modifiedCount
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

    // Clear all pending notification logs and log the rejection
    await NotificationLog.updateMany(
      { tenantId: req.tenantId, documentId: doc._id, status: { $in: ["pending", "scheduled"] } },
      {
        $set: { status: "skipped" },
        $push: {
          modifications: {
            modifiedAt: new Date(),
            modifiedBy: rejectedBy,
            action: "rejected",
            details: reason
          }
        }
      }
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

    if (!doc.storagePath) {
      return res.status(400).json({ error: { message: "Source document path missing; cannot reprocess" } });
    }

    const parserResult = await parsePdf(doc.storagePath);
    const rawText = parserResult.rawText || "";
    const provider = req.body.provider || "ollama";

    doc.status = "processing";
    await doc.save();

    const extractionResult = await extractStructuredData({
      docType: doc.docType,
      rawText,
      filePath: doc.storagePath,
      pageCount: parserResult.pageCount || latestVersion?.parserOutput?.pageCount || 0,
      provider,
      structuredData: parserResult.structuredData
    });

    latestVersion.parserOutput = {
      ...(latestVersion.parserOutput || {}),
      rawTextLength: rawText.length,
      pageCount: parserResult.pageCount || latestVersion?.parserOutput?.pageCount || 0
    };

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

const path = require("path");

const express = require("express");
const multer = require("multer");

const env = require("../config/env");
const Document = require("../models/Document");
const DocumentVersion = require("../models/DocumentVersion");
const { processUploadedDocument } = require("../services/pipeline/documentPipeline");

const router = express.Router();

const upload = multer({
  dest: path.resolve(process.cwd(), env.uploadDir),
  limits: {
    fileSize: 20 * 1024 * 1024
  }
});

router.post("/upload", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: { message: "file is required" } });
    }

    const title = req.body.title || req.file.originalname;
    const docType = req.body.docType || "exam_timetable";

    const result = await processUploadedDocument({
      tenantId: req.tenantId,
      title,
      docType,
      file: req.file,
      uploadedBy: req.body.uploadedBy || "admin"
    });

    return res.status(201).json({
      document: {
        id: result.document._id,
        title: result.document.title,
        status: result.document.status,
        docType: result.document.docType,
        nextAction: result.nextAction
      },
      extractionSummary: {
        confidenceScore: result.version.extraction.confidenceScore,
        warnings: result.version.extraction.warnings,
        eventCount: result.version.extraction.events.length
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const docs = await Document.find({ tenantId: req.tenantId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json({
      items: docs.map((doc) => ({
        id: doc._id,
        title: doc.title,
        docType: doc.docType,
        status: doc.status,
        createdAt: doc.createdAt
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const doc = await Document.findOne({ _id: req.params.id, tenantId: req.tenantId }).lean();

    if (!doc) {
      return res.status(404).json({ error: { message: "Document not found" } });
    }

    const latestVersion = await DocumentVersion.findOne({
      tenantId: req.tenantId,
      documentId: doc._id,
      versionNumber: doc.latestVersion
    }).lean();

    return res.json({
      document: {
        id: doc._id,
        title: doc.title,
        docType: doc.docType,
        status: doc.status,
        sourceFileName: doc.sourceFileName,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt
      },
      latestVersion: latestVersion
        ? {
            versionNumber: latestVersion.versionNumber,
            parserOutput: latestVersion.parserOutput,
            extraction: latestVersion.extraction
          }
        : null
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

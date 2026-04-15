const express = require("express");
const cors = require("cors");
const compression = require("compression");

const tenantContext = require("./middleware/tenantContext");
const { requireAuth } = require("./middleware/auth");
const errorHandler = require("./middleware/errorHandler");
const { noStoreCache, publicCache } = require("./middleware/cacheHeaders");
const authRoutes = require("./routes/auth");
const healthRoutes = require("./routes/health");
const documentRoutes = require("./routes/documents");
const userRoutes = require("./routes/users");
const notificationRoutes = require("./routes/notifications");
const studentRoutes = require("./routes/students");
const systemRoutes = require("./routes/system");
const targetingRoutes = require("./routes/targeting");
const { getJob, cancelJob } = require("./services/jobs/jobStore");

const app = express();

app.use(cors());
app.use(compression({ threshold: 1024 }));
app.use(noStoreCache);
app.use(express.json({ limit: "2mb" }));
app.use(tenantContext);

app.use("/auth", authRoutes);
app.use("/health", publicCache(60), healthRoutes);
app.use("/documents", requireAuth, documentRoutes);
app.use("/users", requireAuth, userRoutes);
app.use("/notifications", requireAuth, notificationRoutes);
app.use("/students", requireAuth, studentRoutes);
app.use("/system", requireAuth, systemRoutes);
app.use("/targeting", requireAuth, targetingRoutes);

// ── Real-time job progress polling endpoint ──────────────────────────────────
app.get("/jobs/:jobId", requireAuth, tenantContext, (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

// ── Cancel an active job ─────────────────────────────────────────────────────
app.post("/jobs/:jobId/cancel", requireAuth, tenantContext, (req, res) => {
  const cancelled = cancelJob(req.params.jobId);
  if (cancelled) {
    res.json({ success: true, message: "Job cancelled successfully" });
  } else {
    res.status(404).json({ error: "Job not found or already complete" });
  }
});

app.use(errorHandler);

module.exports = app;

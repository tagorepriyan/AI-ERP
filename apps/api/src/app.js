const express = require("express");
const cors = require("cors");

const tenantContext = require("./middleware/tenantContext");
const errorHandler = require("./middleware/errorHandler");
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
app.use(express.json({ limit: "2mb" }));
app.use(tenantContext);

app.use("/health", healthRoutes);
app.use("/documents", documentRoutes);
app.use("/users", userRoutes);
app.use("/notifications", notificationRoutes);
app.use("/students", studentRoutes);
app.use("/system", systemRoutes);
app.use("/targeting", targetingRoutes);

// ── Real-time job progress polling endpoint ──────────────────────────────────
app.get("/jobs/:jobId", tenantContext, (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

// ── Cancel an active job ─────────────────────────────────────────────────────
app.post("/jobs/:jobId/cancel", tenantContext, (req, res) => {
  const cancelled = cancelJob(req.params.jobId);
  if (cancelled) {
    res.json({ success: true, message: "Job cancelled successfully" });
  } else {
    res.status(404).json({ error: "Job not found or already complete" });
  }
});

app.use(errorHandler);

module.exports = app;

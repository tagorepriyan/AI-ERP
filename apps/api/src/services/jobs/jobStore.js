/**
 * jobStore.js
 * In-memory job progress store for tracking AI extraction pipeline status.
 * Allows the frontend to poll for real-time progress updates.
 */

const jobs = new Map();
const abortControllers = new Map(); // Store AbortControllers for cancellation

const STAGES = [
  { id: "upload",    label: "Document received",              pct: 5,  estSec: 1 },
  { id: "parse",     label: "Parsing PDF structure...",       pct: 20, estSec: 8 },
  { id: "ocr",       label: "Extracting text (OCR)...",       pct: 40, estSec: 15 },
  { id: "ai",        label: "Analyzing with AI model...",     pct: 70, estSec: 120 },
  { id: "routing",   label: "Running routing engine...",      pct: 88, estSec: 3 },
  { id: "saving",    label: "Saving results to database...",  pct: 95, estSec: 2 },
  { id: "done",      label: "Processing complete",            pct: 100, estSec: 0 },
  { id: "error",     label: "Processing failed",              pct: 0,  estSec: 0 }
];

function createJob(jobId) {
  const job = {
    jobId,
    stage: "upload",
    label: STAGES[0].label,
    pct: STAGES[0].pct,
    estimatedRemainingSec: 150,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    error: null
  };
  jobs.set(jobId, job);
  abortControllers.set(jobId, new AbortController());
  return job;
}

function updateJob(jobId, stageId, extraLabel = "") {
  const job = jobs.get(jobId);
  if (!job) return;

  const stage = STAGES.find(s => s.id === stageId) || STAGES[0];
  const elapsedSec = (Date.now() - job.startedAt) / 1000;

  // Estimate remaining time based on remaining stages
  const remaining = STAGES
    .filter(s => STAGES.indexOf(s) > STAGES.findIndex(s2 => s2.id === stageId))
    .reduce((acc, s) => acc + s.estSec, 0);

  job.stage = stageId;
  job.label = extraLabel || stage.label;
  job.pct = Math.max(job.pct, stage.pct); // Don't allow pct to go backwards
  job.estimatedRemainingSec = Math.max(0, remaining);
  job.elapsedSec = Math.round(elapsedSec);
  job.updatedAt = Date.now();
}

function failJob(jobId, errorMsg) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.stage = "error";
  job.label = `Error: ${errorMsg}`;
  job.pct = 0;
  job.error = errorMsg;
  job.updatedAt = Date.now();
  abortControllers.delete(jobId);
}

function completeJob(jobId, recipientCount = 0) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.stage = "done";
  job.label = `Done — ${recipientCount} recipients identified`;
  job.pct = 100;
  job.estimatedRemainingSec = 0;
  job.elapsedSec = Math.round((Date.now() - job.startedAt) / 1000);
  job.recipientCount = recipientCount;
  job.updatedAt = Date.now();
  abortControllers.delete(jobId);

  // Clean up after 10 minutes
  setTimeout(() => {
    jobs.delete(jobId);
    abortControllers.delete(jobId);
  }, 10 * 60 * 1000);
}

function getJob(jobId) {
  return jobs.get(jobId) || null;
}

function getJobSignal(jobId) {
  return abortControllers.get(jobId)?.signal;
}

function cancelJob(jobId) {
  const controller = abortControllers.get(jobId);
  if (controller) {
    controller.abort(new Error("Job cancelled by user"));
    failJob(jobId, "Cancelled by user");
    return true;
  }
  return false;
}

function isCancelled(jobId) {
  return abortControllers.get(jobId)?.signal?.aborted || false;
}

module.exports = { createJob, updateJob, failJob, completeJob, getJob, getJobSignal, cancelJob, isCancelled, STAGES };

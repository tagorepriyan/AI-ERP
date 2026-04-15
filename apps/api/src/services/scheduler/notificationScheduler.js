const NotificationLog = require("../../models/NotificationLog");
const Document = require("../../models/Document");

const DEFAULT_INTERVAL_MS = 30_000;

let intervalHandle = null;
let reconcileRunning = false;

async function reconcileScheduledNotifications() {
  const now = new Date();
  const scheduledLogs = await NotificationLog.find({
    status: "scheduled",
    scheduledAt: { $lte: now }
  })
    .select("_id documentId tenantId scheduledAt")
    .lean();

  if (scheduledLogs.length === 0) {
    return { deliveredCount: 0, documentCount: 0 };
  }

  const scheduledIds = scheduledLogs.map((log) => log._id);
  await NotificationLog.updateMany(
    { _id: { $in: scheduledIds }, status: "scheduled" },
    {
      $set: {
        status: "delivered",
        sentAt: now,
        "channels.inApp.sent": true,
        "channels.inApp.sentAt": now
      }
    }
  );

  const documentIds = [...new Set(scheduledLogs.map((log) => log.documentId).filter(Boolean).map(String))];
  let documentCount = 0;

  if (documentIds.length > 0) {
    const documentResult = await Document.updateMany(
      { _id: { $in: documentIds }, status: "scheduled" },
      { $set: { status: "published" } }
    );
    documentCount = documentResult.modifiedCount || 0;
  }

  return { deliveredCount: scheduledLogs.length, documentCount };
}

async function runReconciliationCycle() {
  if (reconcileRunning) {
    return;
  }

  reconcileRunning = true;
  try {
    const result = await reconcileScheduledNotifications();
    if (result.deliveredCount > 0 || result.documentCount > 0) {
      console.log(
        `[scheduler] Reconciled ${result.deliveredCount} scheduled notifications and ${result.documentCount} documents`
      );
    }
  } catch (error) {
    console.error(`[scheduler] Reconciliation failed: ${error.message}`);
  } finally {
    reconcileRunning = false;
  }
}

function startNotificationScheduler({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  if (intervalHandle) {
    return;
  }

  runReconciliationCycle();
  intervalHandle = setInterval(runReconciliationCycle, intervalMs);

  if (typeof intervalHandle.unref === "function") {
    intervalHandle.unref();
  }
}

function stopNotificationScheduler() {
  if (!intervalHandle) {
    return;
  }

  clearInterval(intervalHandle);
  intervalHandle = null;
}

module.exports = {
  startNotificationScheduler,
  stopNotificationScheduler,
  reconcileScheduledNotifications
};
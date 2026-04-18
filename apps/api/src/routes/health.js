const express = require("express");
const mongoose = require("mongoose");
const env = require("../config/env");

const router = express.Router();

async function checkProvider({ name, configured, execute }) {
  if (!configured) {
    return {
      provider: name,
      configured: false,
      active: false,
      status: "missing_key",
      latencyMs: null,
      error: "API key not configured"
    };
  }

  const startedAt = Date.now();

  try {
    await execute();
    return {
      provider: name,
      configured: true,
      active: true,
      status: "active",
      latencyMs: Date.now() - startedAt,
      error: ""
    };
  } catch (error) {
    return {
      provider: name,
      configured: true,
      active: false,
      status: "unreachable",
      latencyMs: Date.now() - startedAt,
      error: (error?.message || "Unknown error").slice(0, 200)
    };
  }
}

function throwIfNotOk(name, response, bodyText) {
  if (!response.ok) {
    throw new Error(`${name} ${response.status}: ${bodyText.slice(0, 120)}`);
  }
}

function normalizeAzureEndpoint(endpoint) {
  return (endpoint || "").trim().replace(/\/+$/, "");
}

function createProbePdfBuffer() {
  // Create a minimal valid PDF with proper dimensions for Azure Vision
  // Azure Vision requires: 50×50 to 10000×10000 pixel minimum
  // Create a 200×200 point PDF with visible content
  const contentStream = "BT /F1 12 Tf 20 180 Td (Azure Vision) Tj 0 -20 Td (Health Check) Tj ET";
  const objects = [];
  const offsets = [];
  let body = "%PDF-1.4\n";

  function addObject(objectText) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${objects.length + 1} 0 obj\n${objectText}\nendobj\n`;
    objects.push(objectText);
  }

  addObject("<< /Type /Catalog /Pages 2 0 R >>");
  addObject("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  // MediaBox: [0 0 200 200] = 200×200 points (~2.78×2.78 inches at 72 DPI = 200×200 pixels when rendered)
  addObject("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>");
  addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  addObject(`<< /Length ${Buffer.byteLength(contentStream, "latin1")} >>\nstream\n${contentStream}\nendstream`);

  const xrefOffset = Buffer.byteLength(body, "latin1");
  body += "xref\n";
  body += `0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += "trailer\n";
  body += `<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  body += "startxref\n";
  body += `${xrefOffset}\n`;
  body += "%%EOF\n";

  return Buffer.from(body, "latin1");
}

async function checkAzureVision() {
  const endpoint = normalizeAzureEndpoint(env.ai.azureVision.endpoint);
  const apiKey = env.ai.azureVision.apiKey;

  if (!endpoint || !apiKey) {
    return {
      provider: "azure_vision",
      configured: false,
      active: false,
      status: "missing_key_or_endpoint",
      latencyMs: null,
      error: "Azure Vision endpoint/key not configured"
    };
  }

  const startedAt = Date.now();
  const probeImage = createProbePdfBuffer();

  try {
    const submitResponse = await fetch(`${endpoint}/vision/v3.2/read/analyze`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": apiKey,
        "Content-Type": "application/octet-stream"
      },
      body: probeImage
    });

    if (!submitResponse.ok) {
      const bodyText = await submitResponse.text();
      throw new Error(`Azure Vision submit failed: ${submitResponse.status} ${bodyText.slice(0, 120)}`);
    }

    const operationLocation = submitResponse.headers.get("operation-location");
    if (!operationLocation) {
      throw new Error("Azure Vision did not return operation-location");
    }

    const timeoutMs = 12000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const pollResponse = await fetch(operationLocation, {
        method: "GET",
        headers: { "Ocp-Apim-Subscription-Key": apiKey }
      });

      if (!pollResponse.ok) {
        const bodyText = await pollResponse.text();
        throw new Error(`Azure Vision poll failed: ${pollResponse.status} ${bodyText.slice(0, 120)}`);
      }

      const payload = await pollResponse.json();
      const status = String(payload?.status || "").toLowerCase();

      if (status === "succeeded") {
        return {
          provider: "azure_vision",
          configured: true,
          active: true,
          status: "active",
          latencyMs: Date.now() - startedAt,
          error: ""
        };
      }

      if (status === "failed") {
        throw new Error("Azure Vision Read returned failed status");
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error("Azure Vision OCR timed out");
  } catch (error) {
    return {
      provider: "azure_vision",
      configured: true,
      active: false,
      status: "unreachable",
      latencyMs: Date.now() - startedAt,
      error: (error?.message || "Unknown error").slice(0, 200)
    };
  }
}

router.get("/", async (req, res) => {
  const dbHealth = {
    connected: mongoose.connection.readyState === 1,
    name: mongoose.connection.name || null,
    documents: null,
    notifications: null
  };

  if (dbHealth.connected) {
    try {
      const db = mongoose.connection.db;
      dbHealth.documents = await db.collection("documents").countDocuments();
      dbHealth.notifications = await db.collection("notificationlogs").countDocuments();
    } catch (error) {
      dbHealth.error = (error?.message || "Unknown error").slice(0, 120);
    }
  }

  res.json({
    status: "ok",
    service: "ai-erp-api",
    tenantId: req.tenantId,
    timestamp: new Date().toISOString(),
    db: dbHealth
  });
});

router.get("/ai", async (req, res, next) => {
  try {
    const checks = await Promise.all([
      checkProvider({
        name: "gemini",
        configured: Boolean(env.ai.gemini.apiKey),
        execute: async () => {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${env.ai.gemini.apiKey}`,
            { method: "GET" }
          );
          const bodyText = await response.text();
          throwIfNotOk("Gemini", response, bodyText);
        }
      }),
      checkProvider({
        name: "groq",
        configured: Boolean(env.ai.groq.apiKey),
        execute: async () => {
          const response = await fetch(`${env.ai.groq.baseUrl.replace(/\/+$/, "")}/models`, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${env.ai.groq.apiKey}`
            }
          });
          const bodyText = await response.text();
          throwIfNotOk("Groq", response, bodyText);
        }
      }),
      checkProvider({
        name: "openrouter",
        configured: Boolean(env.ai.openrouter.apiKey),
        execute: async () => {
          const response = await fetch(`${env.ai.openrouter.baseUrl.replace(/\/+$/, "")}/models`, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${env.ai.openrouter.apiKey}`
            }
          });
          const bodyText = await response.text();
          throwIfNotOk("OpenRouter", response, bodyText);
        }
      }),
      checkAzureVision()
    ]);

    const summary = {
      activeCount: checks.filter((item) => item.active).length,
      configuredCount: checks.filter((item) => item.configured).length,
      totalCount: checks.length
    };

    res.json({
      status: "ok",
      checkedAt: new Date().toISOString(),
      providerOrder: env.ai.providerOrder,
      summary,
      providers: checks
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

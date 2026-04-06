const express = require("express");
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

router.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "ai-erp-api",
    tenantId: req.tenantId,
    timestamp: new Date().toISOString()
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
      })
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

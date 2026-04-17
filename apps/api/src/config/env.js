const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

const cwdEnvPath = path.resolve(process.cwd(), ".env");
const repoRootEnvPath = path.resolve(__dirname, "../../../../.env");
const envPath = fs.existsSync(cwdEnvPath) ? cwdEnvPath : repoRootEnvPath;

dotenv.config({ path: envPath });

function normalizeApiKey(value) {
  const key = (value || "").trim();
  if (!key) {
    return "";
  }

  if (["your_api_key_here", "replace_me", "changeme"].includes(key.toLowerCase())) {
    return "";
  }

  return key;
}

function parseProviderOrder(value) {
  const allowed = ["gemini", "groq", "openrouter"];
  const parsed = (value || "groq,gemini,openrouter")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => allowed.includes(item));

  return parsed.length ? parsed : ["groq", "gemini", "openrouter"];
}

const geminiApiKey = normalizeApiKey(process.env.GEMINI_API_KEY);
const groqApiKey = normalizeApiKey(process.env.GROQ_API_KEY);
const openRouterApiKey = normalizeApiKey(process.env.OPENROUTER_API_KEY);

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 4000),
  mongodbUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/ai_erp",
  uploadDir: process.env.UPLOAD_DIR || "apps/api/uploads",
  defaultTenantId: process.env.DEFAULT_TENANT_ID || "default-campus",
  ai: {
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || 30000),
    providerOrder: parseProviderOrder(process.env.AI_PROVIDER_ORDER),
    gemini: {
      apiKey: geminiApiKey,
      model: process.env.GEMINI_MODEL || process.env.AI_MODEL || "gemini-2.5-flash"
    },
    groq: {
      apiKey: groqApiKey,
      model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
      baseUrl: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1"
    },
    openrouter: {
      apiKey: openRouterApiKey,
      model: process.env.OPENROUTER_MODEL || "meta-llama/llama-3.1-8b-instruct:free",
      baseUrl: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1"
    },
    // Backward-compatible aliases (Gemini defaults)
    apiKey: geminiApiKey,
    model: process.env.GEMINI_MODEL || process.env.AI_MODEL || "gemini-2.5-flash"
  }
};

module.exports = env;

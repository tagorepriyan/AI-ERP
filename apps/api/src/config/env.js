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
const azureVisionApiKey = normalizeApiKey(process.env.AZURE_VISION_KEY || process.env.AZURE_COMPUTER_VISION_KEY);

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 4000),
  mongodbUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/ai_erp",
  uploadDir: process.env.UPLOAD_DIR || path.resolve(__dirname, "../../uploads"),
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
    ollama: {
      baseUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
      model: process.env.OLLAMA_MODEL || "gemma4:e2b",
      timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS || 600000),
      maxPdfPages: Number(process.env.OLLAMA_MAX_PDF_PAGES || 3),
      pdfViewportScale: Number(process.env.OLLAMA_PDF_IMAGE_SCALE || 1.45)
    },
    azureVision: {
      apiKey: azureVisionApiKey,
      endpoint: (process.env.AZURE_VISION_ENDPOINT || "").trim(),
      timeoutMs: Number(process.env.AZURE_VISION_TIMEOUT_MS || 120000),
      pollIntervalMs: Number(process.env.AZURE_VISION_POLL_INTERVAL_MS || 1000)
    },
    hybridOcrTimeoutMs: Number(process.env.HYBRID_OCR_TIMEOUT_MS || 25000),
    fastModeBudgetMs: Number(process.env.FAST_MODE_BUDGET_MS || 30000),
    // Backward-compatible aliases (Gemini defaults)
    apiKey: geminiApiKey,
    model: process.env.GEMINI_MODEL || process.env.AI_MODEL || "gemini-2.5-flash"
  }
};

module.exports = env;

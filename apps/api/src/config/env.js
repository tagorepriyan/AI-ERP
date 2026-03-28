const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 4000),
  mongodbUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/ai_erp",
  uploadDir: process.env.UPLOAD_DIR || "apps/api/uploads",
  defaultTenantId: process.env.DEFAULT_TENANT_ID || "default-campus",
  ai: {
    apiKey: process.env.GEMINI_API_KEY || "",
    model: process.env.AI_MODEL || "gemini-2.0-flash",
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || 30000)
  }
};

module.exports = env;

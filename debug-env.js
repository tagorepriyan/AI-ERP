const env = require('./apps/api/src/config/env');
console.log(JSON.stringify({
  geminiKey_present: env.ai.gemini.apiKey.length > 0,
  groqKey_present: env.ai.groq.apiKey.length > 0,
  openrouterKey_present: env.ai.openrouter.apiKey.length > 0,
  providerOrder: env.ai.providerOrder,
  enabledProviders: [
    env.ai.gemini.apiKey ? 'gemini' : null,
    env.ai.groq.apiKey ? 'groq' : null,
    env.ai.openrouter.apiKey ? 'openrouter' : null
  ].filter(Boolean)
}, null, 2));

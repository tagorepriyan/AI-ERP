const app = require("./app");
const env = require("./config/env");
const { connectDb } = require("./config/db");

async function bootstrap() {
  try {
    await connectDb(env.mongodbUri);
    const server = app.listen(env.port, () => {
      console.log(`API listening on http://localhost:${env.port}`);
    });
    
    // Set server timeouts to handle large file uploads (10 minutes)
    server.setTimeout(600000); // 10 minutes for socket timeout
    server.keepAliveTimeout = 600000;
    server.headersTimeout = 610000;
  } catch (error) {
    console.error("Failed to start API:", error);
    process.exit(1);
  }
}

bootstrap();

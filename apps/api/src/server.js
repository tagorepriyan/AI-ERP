const app = require("./app");
const env = require("./config/env");
const { connectDb } = require("./config/db");
const { startNotificationScheduler } = require("./services/scheduler/notificationScheduler");

async function bootstrap() {
  try {
    await connectDb(env.mongodbUri);
    startNotificationScheduler();
    app.listen(env.port, () => {
      console.log(`API listening on http://localhost:${env.port}`);
    });
  } catch (error) {
    console.error("Failed to start API:", error);
    process.exit(1);
  }
}

bootstrap();

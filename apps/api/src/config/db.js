const mongoose = require("mongoose");

async function connectDb(mongodbUri) {
  mongoose.set("strictQuery", true);
  await mongoose.connect(mongodbUri);
}

module.exports = { connectDb };

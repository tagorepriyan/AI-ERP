const express = require("express");
const cors = require("cors");

const tenantContext = require("./middleware/tenantContext");
const errorHandler = require("./middleware/errorHandler");
const healthRoutes = require("./routes/health");
const documentRoutes = require("./routes/documents");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(tenantContext);

app.use("/health", healthRoutes);
app.use("/documents", documentRoutes);

app.use(errorHandler);

module.exports = app;

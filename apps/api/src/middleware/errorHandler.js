function errorHandler(err, _req, res, _next) {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal server error";

  res.status(statusCode).json({
    error: {
      message,
      statusCode
    }
  });
}

module.exports = errorHandler;

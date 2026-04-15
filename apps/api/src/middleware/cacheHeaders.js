function noStoreCache(req, res, next) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
}

function publicCache(maxAgeSec) {
  return function applyPublicCache(req, res, next) {
    res.setHeader("Cache-Control", `public, max-age=${maxAgeSec}`);
    next();
  };
}

module.exports = {
  noStoreCache,
  publicCache
};

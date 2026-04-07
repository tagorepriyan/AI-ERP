const express = require("express");
const si = require("systeminformation");

const router = express.Router();

// Cache to avoid hammering the OS too frequently
let cache = null;
let lastFetch = 0;
const CACHE_MS = 1500; // refresh at most every 1.5s

async function getStats() {
  const now = Date.now();
  if (cache && now - lastFetch < CACHE_MS) return cache;

  const [cpuLoad, cpuTemp, mem, graphics] = await Promise.all([
    si.currentLoad(),
    si.cpuTemperature(),
    si.mem(),
    si.graphics()
  ]);

  const gpu = graphics.controllers?.[0] || {};

  cache = {
    cpu: {
      load: Math.round(cpuLoad.currentLoad * 10) / 10,
      cores: cpuLoad.cpus?.length || 0,
      tempC: cpuTemp.main ?? null
    },
    ram: {
      totalGB: +(mem.total / 1073741824).toFixed(1),
      usedGB: +((mem.total - mem.available) / 1073741824).toFixed(1),
      freeGB: +(mem.available / 1073741824).toFixed(1),
      usagePct: Math.round(((mem.total - mem.available) / mem.total) * 100)
    },
    gpu: {
      model: gpu.model || "N/A",
      vendor: gpu.vendor || "",
      vramTotalMB: gpu.vram || 0,
      vramUsedMB: gpu.memoryUsed || null,
      vramFreeMB: gpu.memoryFree || null,
      utilizationPct: gpu.utilizationGpu ?? null,
      tempC: gpu.temperatureGpu ?? null,
      clockMHz: gpu.clockCore || null,
      memClockMHz: gpu.clockMemory || null
    },
    timestamp: now
  };

  lastFetch = now;
  return cache;
}

router.get("/", async (_req, res, next) => {
  try {
    const stats = await getStats();
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";

const certPath = path.resolve(__dirname, "cert.pem");
const keyPath  = path.resolve(__dirname, "key.pem");
const hasCerts = fs.existsSync(certPath) && fs.existsSync(keyPath);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    host: "0.0.0.0",
    ...(hasCerts ? {
      https: {
        cert: fs.readFileSync(certPath),
        key:  fs.readFileSync(keyPath),
      }
    } : {}),
    // Proxy all /api calls to the HTTP backend — solves mixed-content block
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
        secure: false
      }
    }
  }
});


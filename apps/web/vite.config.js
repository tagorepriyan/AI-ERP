import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("react")) return "react-vendor";
          return "vendor";
        }
      }
    }
  },
  server: {
    port: 5173,
    host: "0.0.0.0"
  }
});

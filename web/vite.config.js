import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@shared": fileURLToPath(new URL("../shared", import.meta.url)) } },
  server: {
    proxy: { "/api": "http://localhost:5000" },
    fs: { allow: [".."] },
  },
  build: { outDir: "dist", assetsInlineLimit: 0 },
});

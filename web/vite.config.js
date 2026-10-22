import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The hidden admin URL never appears in the public bundle: only its SHA-256.
// ADMIN_PATH is the same environment variable the backend uses.
const adminPath = (process.env.ADMIN_PATH || "").replace(/^\/+|\/+$/g, "");
const adminPathHash = adminPath ? createHash("sha256").update(adminPath).digest("hex") : "";

export default defineConfig({
  plugins: [react()],
  define: { __ADMIN_PATH_HASH__: JSON.stringify(adminPathHash) },
  resolve: { alias: { "@shared": fileURLToPath(new URL("../shared", import.meta.url)) } },
  server: {
    proxy: { "/api": "http://localhost:5000" },
    fs: { allow: [".."] },
  },
  build: { outDir: "dist", assetsInlineLimit: 0 },
});

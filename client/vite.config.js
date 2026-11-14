import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  const apiMode = process.env.VITE_API_MODE || env.VITE_API_MODE;
  const apiTarget =
    process.env.API_PROXY_TARGET || env.VITE_API_PROXY_TARGET || "http://127.0.0.1:5000";
  return {
    plugins: [react()],
    // 'real' talks to the backend, anything else uses the in-memory mock (see client/README.md).
    // The process environment wins so run.sh can switch modes without writing a .env file.
    define: {
      __API_MODE__: JSON.stringify(apiMode === "real" ? "real" : "mock"),
      // Production builds must not render the developer tool, even by direct URL.
      __PRODUCTION__: JSON.stringify(mode === "production"),
      // Local demo quick-fill password; the backend still verifies it normally.
      __DEMO_PASSWORD__: JSON.stringify(
        process.env.VITE_DEMO_PASSWORD || env.VITE_DEMO_PASSWORD || "password123",
      ),
    },
    server: {
      // The Express + Socket.io backend listens on 127.0.0.1:5000 by default.
      proxy: {
        "/api": apiTarget,
        "/socket.io": { target: apiTarget, ws: true },
      },
    },
  };
});

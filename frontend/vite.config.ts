import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(() => ({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:5179",
      "/ws": {
        target: "ws://127.0.0.1:5179",
        ws: true
      }
    }
  }
}));

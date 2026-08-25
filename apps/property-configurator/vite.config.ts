import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  // The app has its own product UI but intentionally reuses the audited demo assets.
  publicDir: "../demo/public",
  plugins: [react()],
});

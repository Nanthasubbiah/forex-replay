/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Build with relative asset URLs so the same `dist/` works from the dev server,
  // a subpath host, and GitHub Pages (https://<user>.github.io/<repo>/) alike.
  base: command === "build" ? "./" : "/",
  server: { port: 5173, strictPort: false },
  build: { target: "es2022" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
}));

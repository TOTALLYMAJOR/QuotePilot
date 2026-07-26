import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  envDir: ".",
  publicDir: "public",
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, "/");
          if (normalizedId.includes("/node_modules/@firebase/") || normalizedId.includes("/node_modules/firebase/")) {
            return "vendor-firebase";
          }
          if (
            normalizedId.includes("/node_modules/react/") ||
            normalizedId.includes("/node_modules/react-dom/") ||
            normalizedId.includes("/node_modules/scheduler/")
          ) {
            return "vendor-react";
          }
          return undefined;
        }
      }
    }
  },
  test: {
    include: ["src/**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", "dist/**"]
  }
});

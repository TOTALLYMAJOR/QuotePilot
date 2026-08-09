import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const COMMERCIAL_DEPENDENCY_GRAPH_CORE = fileURLToPath(
  new URL("./src/lib/commercialDependencyGraphCore.cjs", import.meta.url)
);

export default defineConfig({
  envDir: ".",
  publicDir: "public",
  plugins: [react()],
  resolve: {
    alias: {
      "commercial-dependency-graph-core": COMMERCIAL_DEPENDENCY_GRAPH_CORE
    }
  },
  optimizeDeps: {
    include: ["commercial-dependency-graph-core"]
  },
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
          if (normalizedId.endsWith("/src/lib/quoteStore.js")) {
            return "workspace-quote-store";
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

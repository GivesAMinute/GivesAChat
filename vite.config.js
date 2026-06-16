import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: resolve(__dirname, "src/overlay"),
  build: {
    outDir: resolve(__dirname, "backend/dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "src/overlay/index.html")
    }
  }
});

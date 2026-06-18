import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: resolve(__dirname, "../src/overlay"),
  build: {
    outDir: resolve(__dirname, "dist/overlay"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "../src/overlay/index.html"),
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});

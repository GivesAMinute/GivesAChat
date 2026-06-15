import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: resolve(__dirname, "src/overlay"),
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        overlay: resolve(__dirname, "src/overlay/index.html")
      },
      output: {
        entryFileNames: "overlay.js",
        assetFileNames: "overlay.[ext]"
      }
    }
  }
});

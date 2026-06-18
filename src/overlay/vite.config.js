import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  root: __dirname,
  build: {
    outDir: path.resolve(__dirname, "../../backend/dist/overlay"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "index.html"),
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});

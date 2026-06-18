import { defineConfig } from "vite";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Repo root = backend/..
const repoRoot = resolve(__dirname, "..");

export default defineConfig({
  root: resolve(repoRoot, "src/overlay"),
  build: {
    outDir: resolve(__dirname, "dist/overlay"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(repoRoot, "src/overlay/index.html"),
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});

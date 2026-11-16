import path from "node:path";
import { fileURLToPath } from "node:url";

/* ---------------------------------------------------------
   Plain-Node test config, alongside vitest.config.js.

   vitest.config.js runs tests inside the Workers runtime via
   @cloudflare/vitest-pool-workers, which is right for anything
   touching Durable Objects, bindings or the fetch handler.

   Most of the logic worth testing is not that. Transforms,
   emote substitution and claim detection are pure functions
   over a payload, and running them in plain Node means the
   suite starts in ~150ms, needs no workerd binary, and runs on
   any machine — including CI and a Linux container, where the
   macOS workerd build in node_modules cannot execute at all.

   Run with:
     npx vitest run --config vitest.node.config.js

   The alias exists because the overlay's browser modules import
   with server-absolute paths ("/overlay/shared/_sharedPopups.js")
   which the browser resolves against the site root and Node
   cannot resolve at all. Mapping the prefix to public/ lets the
   same file be tested without changing how it ships.
--------------------------------------------------------- */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, "../public");

export default {
  resolve: {
    alias: [{ find: /^\/overlay\//, replacement: `${PUBLIC}/overlay/` }]
  },
  test: {
    include: [
      "test/razoEmotes.test.mjs",
      "test/veloraSocketTransform.test.mjs",
      "test/claimDetection.test.mjs"
    ],
    environment: "node"
  }
};

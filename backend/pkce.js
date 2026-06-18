import crypto from "crypto";

const codeVerifier = crypto.randomBytes(32).toString("hex");
const codeChallenge = crypto
  .createHash("sha256")
  .update(codeVerifier)
  .digest("base64url");

console.log("code_verifier:", codeVerifier);
console.log("code_challenge:", codeChallenge);


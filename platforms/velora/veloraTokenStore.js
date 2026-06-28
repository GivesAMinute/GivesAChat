// platforms/velora/veloraTokenStore.js
import fs from "fs";
import path from "path";

const TOKEN_FILE = path.join(process.cwd(), "velora-refresh.json");

export function loadRefreshToken() {
  if (fs.existsSync(TOKEN_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
      console.log("[VELORA] Loaded refresh token from file");
      return data.refresh_token;
    } catch (err) {
      console.log("[VELORA] Failed to read token file:", err);
    }
  }

  console.log("[VELORA] No token file found, using ENV");
  return process.env.VELORA_REFRESH_TOKEN || null;
}

export function saveRefreshToken(token) {
  try {
    fs.writeFileSync(
      TOKEN_FILE,
      JSON.stringify({ refresh_token: token }, null, 2)
    );
    console.log("[VELORA] Saved new refresh token to file");
  } catch (err) {
    console.log("[VELORA] Failed to save refresh token:", err);
  }
}

import fs from "fs";
import path from "path";

const tokenFile = path.join(process.cwd(), "velora-refresh.json");

export function loadStoredRefreshToken() {
  try {
    const data = JSON.parse(fs.readFileSync(tokenFile, "utf8"));
    return data.refresh_token;
  } catch {
    return null;
  }
}

export function storeRefreshToken(refresh_token) {
  fs.writeFileSync(
    tokenFile,
    JSON.stringify({ refresh_token }, null, 2),
    "utf8"
  );
}

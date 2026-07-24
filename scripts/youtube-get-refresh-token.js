import readline from "node:readline";
import open from "open";
import http from "http";
import { URLSearchParams } from "url";

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const REDIRECT_URI = "https://givesachat-cloudflare.benonkoebsch.workers.dev/velora/callback";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET in environment.");
  process.exit(1);
}

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.force-ssl"
];

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT_URI,
  response_type: "code",
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES.join(" ")
}).toString()}`;

console.log("\nOpen this URL to authorize:\n");
console.log(authUrl + "\n");

open(authUrl);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question("Paste the ?code= value from the redirect URL: ", async (code) => {
  rl.close();

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code"
    })
  });

  const json = await tokenRes.json();
  console.log("\nToken response:\n", json);

  if (json.refresh_token) {
    console.log("\n⭐ Your new refresh token:\n");
    console.log(json.refresh_token);
  } else {
    console.log("\n❌ No refresh token returned. Check test users + redirect URI.\n");
  }
});

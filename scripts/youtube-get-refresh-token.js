import readline from "readline";
import { google } from "googleapis";

// These MUST match your JSON exactly
const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost"; // from your JSON

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

// Scopes required for live chat + broadcast access
const scopes = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.force-ssl"
];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: scopes
});

console.log("\nAuthorize this app by visiting this URL:\n");
console.log(authUrl);
console.log("\nPaste the code here:\n");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question("Code: ", async (code) => {
  rl.close();
  try {
    const { tokens } = await oauth2Client.getToken(code.trim());
    console.log("\nYour refresh token:\n");
    console.log(tokens.refresh_token);
  } catch (err) {
    console.error("Error exchanging code:", err.response?.data || err.message);
  }
});

import WebSocket from "ws";

const socket = new WebSocket("wss://headless-chat-browser-production.up.railway.app");

socket.on("open", () => {
  console.log("Connected. Sending Twitch test…");

  socket.send(JSON.stringify({
    platform: "twitch",
    username: "TwitchTester",
    avatar: "https://i.pravatar.cc/150?img=5",
    html: "Hello from <i>Twitch</i>!",
    badges: [
      "https://static-cdn.jtvnw.net/badges/v1/48x48/mod.png"
    ]
  }));
});

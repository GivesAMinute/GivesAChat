import WebSocket from "ws";

const socket = new WebSocket("wss://headless-chat-browser-production.up.railway.app");

socket.on("open", () => {
  console.log("Connected. Sending Velora reward test…");

  socket.send(JSON.stringify({
    platform: "velora",
    type: "reward",
    username: "RewardTester",
    rewardName: "Mega Bonk",
    rewardIcon: "https://i.imgur.com/0y8Ftya.png",
    rewardColor: "#ff00ff",
    rewardHTML: "<p>This is a <b>reward card</b> test!</p>"
  }));
});

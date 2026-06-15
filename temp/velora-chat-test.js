import WebSocket from "ws";

const socket = new WebSocket("wss://headless-chat-browser-production.up.railway.app");

socket.on("open", () => {
  console.log("Connected. Sending Velora chat test…");

  socket.send(JSON.stringify({
    platform: "velora",
    username: "TestUser",
    avatar: "https://i.pravatar.cc/150?img=12",
    html: "This is a <b>Velora</b> test message!",
    badges: [
      { icon: "https://i.imgur.com/4M7IWwP.png", label: "VIP" }
    ]
  }));
});

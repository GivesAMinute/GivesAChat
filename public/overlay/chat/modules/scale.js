// modules/scale.js

function scaleOverlay() {
  const baseWidth = 1920;
  const baseHeight = 1080;

  const scaleX = window.innerWidth / baseWidth;
  const scaleY = window.innerHeight / baseHeight;
  const scale = Math.min(scaleX, scaleY);

  const root = document.getElementById("overlay-root");
  if (root) root.style.transform = `scale(${scale})`;

  const chat = document.getElementById("chat-container");
  if (chat) chat.style.transform = "none";
}

export { scaleOverlay };

// overlay/chat/badges/blaze/index.js

export function renderBlazeBadges(msg) {
  let out = "";

  // Moderator
  if (msg.isMod) {
    out += `
<span class="tooltip-wrapper">
  <span class="blaze-icon-wrapper">
    <svg class="blaze-large-icon" xmlns="http://www.w3.org/2000/svg"
         viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.2"
         stroke-linecap="round" stroke-linejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
    </svg>
  </span>
  <span class="tooltip-bubble">Moderator</span>
</span>`;
  }

  // OG
  if (msg.isOG) {
    out += `
<span class="tooltip-wrapper">
  <span class="blaze-og-badge">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
         fill="none" stroke="currentColor" stroke-width="2.2"
         stroke-linecap="round" stroke-linejoin="round">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
    </svg>
  </span>
  <span class="tooltip-bubble">OG</span>
</span>`;
  }

  // VIP
  if (msg.isVIP) {
    out += `
<span class="tooltip-wrapper">
  <span class="blaze-vip-badge">
    <img src="https://cdn.blaze.stream/site/icons/vip.png" alt="">
    <span>VIP</span>
  </span>
  <span class="tooltip-bubble">VIP</span>
</span>`;
  }

  // Streamer
  if (msg.isStreamer) {
    out += `
<span class="tooltip-wrapper">
  <span class="blaze-icon-wrapper">
    <svg class="blaze-large-icon" xmlns="http://www.w3.org/2000/svg"
         viewBox="0 0 24 24" fill="none" stroke="red" stroke-width="2.2"
         stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 19v3"></path>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
      <rect x="9" y="2" width="6" height="13" rx="3"></rect>
    </svg>
  </span>
  <span class="tooltip-bubble">Streamer</span>
</span>`;
  }

  return out;
}

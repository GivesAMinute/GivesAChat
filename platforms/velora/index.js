// platforms/velora/index.js
import { getVeloraAccessToken } from "./veloraAuth.js";
import { startVeloraEventsSocket } from "./veloraEventsSocket.js";

export async function startVeloraPlatform({ channelId, onMessage }) {
  console.log("[VELORA] Initializing…");

  const accessToken = await getVeloraAccessToken();

  if (!accessToken) {
    console.error("[VELORA] Failed to obtain access token — Velora disabled");
    return;
  }

  console.log("[VELORA] Access token ready — starting Events API socket…");

  startVeloraEventsSocket({
    onMessage: (event) => {
      const d = event?.data;
      if (!d) return;

      // ⭐ Only send what the overlay expects
      onMessage({
        platform: "velora",

        username: d.displayName,
        message: d.message,
        avatar: d.avatarUrl,

        // ⭐ Badge fields
        badges: d.badges || [],
        subscriptionBadge: d.subscriptionBadge || null,

        isModerator: d.isModerator || false,
        isVip: d.isVip || false,
        isSubscriber: d.isSubscriber || false,
        role: d.role || null
      });
    }
  });

  console.log("[VELORA] Velora platform started");
}

// platforms/velora/index.js
import { getVeloraAccessToken } from "./veloraAuth.js";
import { startVeloraEventsSocket } from "./veloraEventsSocket.js";

/**
 * Velora Platform Initialization
 *
 * - Ensures access token is available
 * - Starts Events API socket (chat + rewards + celebrations)
 * - Chat socket removed (Events API replaces it)
 */

export async function startVeloraPlatform({ channelId, onMessage }) {
  console.log("[VELORA] Initializing…");

  const accessToken = await getVeloraAccessToken();

  if (!accessToken) {
    console.error("[VELORA] Failed to obtain access token — Velora disabled");
    return;
  }

  console.log("[VELORA] Access token ready — starting Events API socket…");

  // ⭐ Unified Velora Events API socket
  startVeloraEventsSocket({
    onMessage: (event) => {
      const d = event?.data;
      if (!d) return;

      // ⭐ Transform Velora raw event → overlay message
      onMessage({
        platform: "velora",
        type: event.event,
        id: d.id,
        timestamp: d.timestamp,

        // Chat essentials
        username: d.displayName,
        message: d.message,
        avatar: d.avatarUrl,

        // ⭐ BADGES (critical fix)
        badges: d.badges || [],

        // ⭐ Subscriber badge (real Velora URL)
        subscriptionBadge: d.subscriptionBadge || null,

        // ⭐ Role flags
        isModerator: d.isModerator || false,
        isVip: d.isVip || false,
        isSubscriber: d.isSubscriber || false,
        role: d.role || null,

        // Extra Velora metadata (optional)
        userId: d.userId,
        channelId: d.channelId,
        userRoles: d.userRoles || [],
        giftedCount: d.giftedCount || 0
      });
    }
  });

  console.log("[VELORA] Velora platform started");
}

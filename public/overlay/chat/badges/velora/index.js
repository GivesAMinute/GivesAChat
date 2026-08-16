// public/overlay/chat/badges/velora/index.js

import { wrapWithTooltip } from "../../utils/tooltip.js";

export function renderVeloraBadges(msg) {
  let out = `<span class="velora-badges">`;

  // ---------------------------------------------------------
  // ⭐ Velora defines badge ORDER in msg.badges (array)
  // ---------------------------------------------------------
  const ordered = Array.isArray(msg.badges) ? msg.badges : [];

  for (const badgeId of ordered) {
    // -------------------------------------------------------
    // ⭐ Subscriber badge (Velora dynamic URL)
    // -------------------------------------------------------
    if (badgeId === "subscription") {
      if (msg.subscriptionBadge?.staticAssetUrl) {
        out += wrapWithTooltip(`
          <img class="velora-badge"
               src="${msg.subscriptionBadge.staticAssetUrl}"
               alt="${msg.subscriptionBadge.label}"
               title="${msg.subscriptionBadge.label}">
        `, msg.subscriptionBadge.label);
      }
      continue;
    }

    // -------------------------------------------------------
    // ⭐ Broadcaster
    // -------------------------------------------------------
    if (badgeId === "broadcaster") {
      if (msg.badges?.includes("broadcaster")) {
        out += wrapWithTooltip(`
          <img class="velora-badge"
               src="/badges/velora/StreamerBroadcasterBadge.png"
               alt="Broadcaster"
               title="Broadcaster">
        `, "Broadcaster");
      }
      continue;
    }

    // -------------------------------------------------------
    // ⭐ Moderator
    // -------------------------------------------------------
    if (badgeId === "moderator") {
      if (msg.badges?.includes("moderator") || msg.isModerator) {
        out += wrapWithTooltip(`
          <img class="velora-badge"
               src="/badges/velora/ModeratorModBadge.png"
               alt="Moderator"
               title="Moderator">
        `, "Moderator");
      }
      continue;
    }

    // -------------------------------------------------------
    // ⭐ VIP
    // -------------------------------------------------------
    if (badgeId === "vip") {
      if (msg.badges?.includes("vip") || msg.isVip) {
        out += wrapWithTooltip(`
          <img class="velora-badge"
               src="/badges/velora/VIPBadge.png"
               alt="VIP"
               title="VIP">
        `, "VIP");
      }
      continue;
    }

    // -------------------------------------------------------
    // ⭐ Gift Leader
    // -------------------------------------------------------
    if (badgeId === "gift_leader") {
      if (msg.badges?.includes("gift_leader") || msg.role === "gift_leader") {
        out += wrapWithTooltip(`
          <img class="velora-badge"
               src="/badges/velora/GifterBadge.png"
               alt="Gift Leader"
               title="Gift Leader">
        `, "Gift Leader");
      }
      continue;
    }

    /* pride-month-2026 used to be hardcoded here with a literal
       CDN url. It now resolves through the catalog below, along
       with every other event badge. */

    /* -------------------------------------------------------
       ⭐ Catalog badges

       Anything outside the role badges above is resolved by the
       worker from /api/badges/catalog and arrives as
       { slug, name, url }. Previously these were dropped, so
       event badges a viewer had earned never appeared — and
       pride-month-2026 only worked because its url was pasted
       in by hand.
    ------------------------------------------------------- */
    const fromCatalog = Array.isArray(msg.catalogBadges)
      ? msg.catalogBadges.find((b) => b && b.slug === badgeId)
      : null;

    if (fromCatalog?.url) {
      const label = String(fromCatalog.name || badgeId).replace(/"/g, "&quot;");

      out += wrapWithTooltip(`
        <img class="velora-badge"
             src="${String(fromCatalog.url).replace(/"/g, "&quot;")}"
             alt="${label}"
             title="${label}">
      `, label);
    }

    // Anything still unresolved is ignored rather than rendered raw.
  }

  out += `</span>`;
  return out;
}

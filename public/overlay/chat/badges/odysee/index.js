/* ---------------------------------------------------------
   Odysee badges

   Commentron is a comment system rather than a chat API, so it
   carries far less about the author than the other platforms
   do — there is no moderator, subscriber or verified flag on
   the wire at all. Only three exist:

     is_creator    -> streamer   (the channel owner)
     is_pinned     -> pinned
     is_protected  -> protected

   Only `streamer` has artwork so far. The other two are mapped
   here but produce nothing until a PNG or SVG exists for them,
   so adding one later is a one-line change.
--------------------------------------------------------- */

const BADGES = {
  broadcaster: {
    src: "/badges/odysee/streamer.svg",
    alt: "Streamer",
    className: "odysee-badge-streamer"
  }
};

export function renderOdyseeBadges(payload) {
  const badges = payload.badges || [];
  if (!Array.isArray(badges) || badges.length === 0) return "";

  const parts = [];

  for (const badge of badges) {
    const type = String(badge?.type || badge || "").toLowerCase();
    const spec = BADGES[type];
    if (!spec) continue;

    parts.push(
      `<img class="inline-badge odysee-badge ${spec.className}" src="${spec.src}" alt="${spec.alt}">`
    );
  }

  return parts.join("");
}

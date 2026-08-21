// givesachat-cloudflare/src/facebookAuth.js

/* ---------------------------------------------------------
   Facebook OAuth + token store

   Facebook is the only platform here with a token that EXPIRES
   ON A CLOCK and cannot be renewed by the server on its own.

     short-lived user token   ~1-2 hours
     long-lived user token    60 days     <- what we hold
     page token               never expires (derived from the above)

   A personal profile has no permanent equivalent, so a human has
   to re-authorise roughly six times a year. Everything here is
   built around making that a single click:

     /facebook/connect   -> Facebook consent -> /facebook/callback

   The app secret never leaves the Worker. The Mac helper and the
   Stream Deck button only ever open a URL, which is why neither
   needs a credential sitting on disk.

   Docs: https://developers.facebook.com/docs/facebook-login/
--------------------------------------------------------- */

export const FB_API = "https://graph.facebook.com/v26.0";

/* Strict Mode is on for redirect URIs, so this must match what is
   registered in the app byte for byte — no trailing slash, no
   extra params, https not http. Built as a constant rather than
   derived from the incoming request: a request arriving on a
   custom domain or with a different case would produce a URI that
   doesn't match, and Facebook's error for that is unhelpful. */
export const REDIRECT_URI =
  "https://givesachat-cloudflare.benonkoebsch.workers.dev/facebook/callback";

/* ---------------------------------------------------------
   Scopes — PAGES, not the personal profile

   Reading live comments from a personal profile is not possible.
   Established by testing, from four directions that agreed:

     - no live-video use case exists to add to the app
     - publish_video is not a valid scope at all any more
     - GET me/live_videos      -> (#100) Missing permissions
     - GET me/videos?fields=…,live_status
                               -> live_status silently ABSENT
     - and, while actually broadcasting, the live video did not
       appear on me/videos even though that call succeeded

   Meta's own overview confirms it: the Live Video API "requires
   pages, groups, or events access tokens". A user token is not
   on that list.

   A requested field coming back MISSING rather than null is
   Graph declining to answer the question — not an empty value.
   That is the tell worth remembering.

   pages_read_user_content is the one that matters most here: it
   covers content created by OTHER people on the Page, which is
   exactly what a viewer comment is. Without it we would see our
   own comments and nobody else's — a failure that looks like
   "chat works" right up until someone else types.
--------------------------------------------------------- */
const SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_read_user_content"
];

/* Warn while there is still comfortably time to act. */
export const EXPIRY_WARN_DAYS = 7;

/* ---------------------------------------------------------
   Which Pages we are allowed to hold tokens for

   Authorising returns a token for EVERY Page the account
   administers — eleven, in this case, most of them photography
   and personal Pages that will never be streamed to. Those
   tokens do not expire, so storing them all would mean keeping
   nine permanent credentials we have no use for.

   So the allowlist is applied at SAVE time, not at read time:
   an unlisted Page's token is discarded and never written down.

   The cost is that adding a Page here needs a reconnect as well
   as a deploy. To stop that failing silently — the worst kind —
   /facebook/status reports any allowlisted id we hold no token
   for, and the callback page says what it skipped.

   Empty means "all Pages", which is only useful for discovery.
--------------------------------------------------------- */
export function allowedPageIds(env) {
  return String(env?.FACEBOOK_PAGE_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export class FacebookTokenStore {
  constructor(state) {
    this.state = state;
    this.storage = state.storage;
  }

  async fetch(request) {
    const url = new URL(request.url);

    try {
      if (url.pathname.endsWith("/get")) {
        const stored = await this.storage.get("token");
        return this.json(stored || {});
      }

      if (url.pathname.endsWith("/set")) {
        const body = await request.json();

        const data = {
          access_token: body.access_token,
          user_id: body.user_id || null,
          user_name: body.user_name || null,

          /* [{ id, name, access_token, tasks }] — these do not
             expire, which is why the Page route removes the
             60-day refresh chore entirely. */
          pages: Array.isArray(body.pages) ? body.pages : [],

          /* Facebook returns expires_in in SECONDS. Reading it as
             ms would put expiry ~60 days in the past and make the
             token look permanently dead. */
          expires_at: body.expires_in
            ? Date.now() + Number(body.expires_in) * 1000
            : null,

          saved_at: Date.now()
        };

        await this.storage.put("token", data);
        return this.json({ ok: true, expires_at: data.expires_at });
      }

      if (url.pathname.endsWith("/clear")) {
        await this.storage.delete("token");
        return this.json({ ok: true });
      }

      /* OAuth state — issued with the redirect, consumed once on
         callback, so a third party can't complete the flow. */
      if (url.pathname.endsWith("/state/put")) {
        const { state } = await request.json();
        await this.storage.put("oauth_state", { state, created_at: Date.now() });
        return this.json({ ok: true });
      }

      if (url.pathname.endsWith("/state/take")) {
        const { state } = await request.json();
        const stored = await this.storage.get("oauth_state");

        // Single use, whatever the outcome.
        await this.storage.delete("oauth_state");

        const valid =
          !!stored &&
          typeof state === "string" &&
          stored.state === state &&
          Date.now() - stored.created_at < 10 * 60 * 1000;

        return this.json({ valid });
      }

      return new Response("FacebookTokenStore", { status: 200 });
    } catch (err) {
      return this.json({ error: String(err?.message || err) }, 500);
    }
  }

  json(body, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" }
    });
  }
}

/* --------------------------------------------------------- */

function store(env) {
  const id = env.FacebookTokenStore.idFromName("facebook-tokens");
  return env.FacebookTokenStore.get(id);
}

export async function getFacebookToken(env) {
  try {
    const res = await store(env).fetch("https://do/get");
    if (!res.ok) return null;

    const json = await res.json();
    return json?.access_token ? json : null;
  } catch {
    return null;
  }
}

export async function saveFacebookToken(env, data) {
  await store(env).fetch("https://do/set", {
    method: "POST",
    body: JSON.stringify(data)
  });
}

export async function clearFacebookToken(env) {
  await store(env).fetch("https://do/clear", { method: "POST" });
}

async function putState(env, state) {
  await store(env).fetch("https://do/state/put", {
    method: "POST",
    body: JSON.stringify({ state })
  });
}

async function takeState(env, state) {
  const res = await store(env).fetch("https://do/state/take", {
    method: "POST",
    body: JSON.stringify({ state })
  });

  if (!res.ok) return false;
  return (await res.json())?.valid === true;
}

/* ---------------------------------------------------------
   Step 1 — send the browser to Facebook

   Deliberately NOT protected by INGEST_KEY. The Stream Deck
   button opens this URL directly, and a key in a URL ends up in
   browser history, referrer headers and proxy logs.

   Instead the CALLBACK checks that the account which just
   authorised is the configured owner. A stranger who finds this
   URL authorises themselves and is rejected — they cannot
   overwrite the stored token with their own.
--------------------------------------------------------- */
export async function beginFacebookAuth(env) {
  const appId = env.FACEBOOK_APP_ID;
  if (!appId) throw new Error("FACEBOOK_APP_ID not configured");

  const state = crypto.randomUUID();
  await putState(env, state);

  const url = new URL("https://www.facebook.com/v26.0/dialog/oauth");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", SCOPES.join(","));
  url.searchParams.set("response_type", "code");

  return url.toString();
}

/* ---------------------------------------------------------
   Step 2 — exchange the code, then upgrade to 60 days

   TWO exchanges, not one. The code exchange returns a token
   lasting a couple of hours; only the fb_exchange_token grant
   turns it into the 60-day one. Skipping the second step
   "works" — chat runs fine, then dies silently that afternoon.
--------------------------------------------------------- */
export async function completeFacebookAuth(env, code, state) {
  if (!(await takeState(env, state))) {
    throw new Error("invalid or expired state");
  }

  const appId = env.FACEBOOK_APP_ID;
  const appSecret = env.FACEBOOK_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error("FACEBOOK_APP_ID / FACEBOOK_APP_SECRET not configured");
  }

  // 1. code -> short-lived token
  const shortUrl = new URL(`${FB_API}/oauth/access_token`);
  shortUrl.searchParams.set("client_id", appId);
  shortUrl.searchParams.set("client_secret", appSecret);
  shortUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  shortUrl.searchParams.set("code", code);

  const shortRes = await fetch(shortUrl.toString());
  const shortJson = await shortRes.json();

  if (!shortRes.ok || !shortJson.access_token) {
    throw new Error(
      `code exchange failed: ${shortJson?.error?.message || shortRes.status}`
    );
  }

  // 2. short-lived -> long-lived (60 days)
  const longUrl = new URL(`${FB_API}/oauth/access_token`);
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", appId);
  longUrl.searchParams.set("client_secret", appSecret);
  longUrl.searchParams.set("fb_exchange_token", shortJson.access_token);

  const longRes = await fetch(longUrl.toString());
  const longJson = await longRes.json();

  if (!longRes.ok || !longJson.access_token) {
    throw new Error(
      `long-lived exchange failed: ${longJson?.error?.message || longRes.status}`
    );
  }

  // 3. who just authorised?
  const meRes = await fetch(
    `${FB_API}/me?fields=id,name&access_token=${encodeURIComponent(
      longJson.access_token
    )}`
  );
  const me = await meRes.json();

  if (!meRes.ok || !me.id) {
    throw new Error(`identity check failed: ${me?.error?.message || meRes.status}`);
  }

  /* The owner check. FACEBOOK_OWNER_ID is empty on the very first
     run — nobody knows their app-scoped id until they have
     authorised once — so the first authorisation is trusted and
     its id reported back to be pinned in config. Every later run
     must match it. */
  const owner = env.FACEBOOK_OWNER_ID;

  if (owner && owner !== me.id) {
    /* ---------------------------------------------------------
       Worded for a human, because a human sees it.

       This is the expected outcome for anyone who is not the
       operator — including a Meta App Review tester, who WILL
       click through this flow. "account 123 is not the
       configured owner" reads like a bug and invites a rejection
       on the grounds that login is broken. It isn't broken; it
       is the access control working.
    --------------------------------------------------------- */
    const err = new Error(
      "Sign-in succeeded, but this app is operated by one person for " +
        "their own Facebook Page and does not store credentials for any " +
        "other account.\n\n" +
        "Your Facebook account was authenticated correctly and nothing " +
        "was saved. This restriction is deliberate: the app has no user " +
        "accounts and is not offered to the public.\n\n" +
        "You can remove its access at any time under Facebook → Settings " +
        "→ Apps and Websites."
    );
    err.notOwner = true;
    throw err;
  }

  /* ---------------------------------------------------------
     4. Page tokens — the whole point of this route

     A Page token derived from a LONG-LIVED user token does not
     expire. That is why step 2 above is load-bearing twice over:
     derive a Page token from the short-lived one instead and you
     get a Page token that dies in two hours, which is a
     genuinely baffling thing to debug.

     All Pages are stored, not just one. Benon streams to a
     profile today and expects two Pages later; resolving which
     is live happens at broadcast time, so there is nothing to
     reconfigure when that changes.
  --------------------------------------------------------- */
  const pagesRes = await fetch(
    `${FB_API}/me/accounts?fields=id,name,access_token,tasks&limit=100` +
      `&access_token=${encodeURIComponent(longJson.access_token)}`
  );
  const pagesJson = await pagesRes.json();

  if (!pagesRes.ok) {
    throw new Error(
      `could not list pages: ${pagesJson?.error?.message || pagesRes.status}`
    );
  }

  const all = (pagesJson.data || [])
    .filter((p) => p.id && p.access_token)
    .map((p) => ({
      id: p.id,
      name: p.name || p.id,
      access_token: p.access_token,
      tasks: p.tasks || []
    }));

  /* Discard unlisted Pages before storing. Their tokens are
     permanent, so the only safe place for one we don't need is
     nowhere. */
  const allowed = allowedPageIds(env);

  const pages = allowed.length
    ? all.filter((p) => allowed.includes(p.id))
    : all;

  const skipped = allowed.length
    ? all.filter((p) => !allowed.includes(p.id)).map((p) => p.name)
    : [];

  /* An id in the allowlist that Facebook didn't return: a typo,
     or a Page the account no longer administers. Surfaced rather
     than left to be discovered mid-stream. */
  const missing = allowed.filter((id) => !all.some((p) => p.id === id));

  await saveFacebookToken(env, {
    access_token: longJson.access_token,
    expires_in: longJson.expires_in,
    user_id: me.id,
    user_name: me.name,
    pages
  });

  return {
    user_id: me.id,
    user_name: me.name,
    expires_in: longJson.expires_in,
    pinned: !!owner,
    pages: pages.map((p) => ({ id: p.id, name: p.name })),
    skippedCount: skipped.length,
    missing
  };
}

/* ---------------------------------------------------------
   Token health, for /facebook/status and the expiry warning
--------------------------------------------------------- */
export function describeToken(token) {
  if (!token?.access_token) {
    return { connected: false, pages: [], daysRemaining: null, expiring: true };
  }

  const days = token.expires_at
    ? Math.floor((token.expires_at - Date.now()) / 86_400_000)
    : null;

  const pages = (token.pages || []).map((p) => ({ id: p.id, name: p.name }));

  return {
    connected: true,
    user_id: token.user_id,
    user_name: token.user_name,

    /* The PAGE tokens are what chat actually runs on, and they
       do not expire. This countdown is the USER token, which
       only matters when re-listing Pages — so it expiring does
       not take chat down, it just means a newly created Page
       won't be discovered until you reconnect. */
    userTokenExpiresAt: token.expires_at
      ? new Date(token.expires_at).toISOString()
      : null,
    daysRemaining: days,
    expired: days !== null && days < 0,
    expiring: days !== null && days <= EXPIRY_WARN_DAYS,

    pageCount: pages.length,
    pages
  };
}

/** The Page we should be reading, by id, or all of them. */
export function pageTokens(token) {
  return (token?.pages || []).filter((p) => p.id && p.access_token);
}

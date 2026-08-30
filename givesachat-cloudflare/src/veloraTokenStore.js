// givesachat-cloudflare/src/veloraTokenStore.js

/* ---------------------------------------------------------
   Alert sample retention.

   3 per event type so a shape can be compared against itself
   (is reward.name ALWAYS null, or was that one payload?), and a
   40 overall ceiling so a new event type appearing upstream
   cannot grow this without bound.
--------------------------------------------------------- */
const PER_TYPE_SAMPLES = 3;
const MAX_SAMPLES = 40;

export class VeloraTokenStore {
  constructor(state) {
    this.state = state;
    this.storage = state.storage;
  }

  async getTokens() {
    try {
      const stored = await this.storage.get("tokens");
      return stored || null;
    } catch {
      return null;
    }
  }

  async saveTokens(json) {
    const data = {
      access_token: json.access_token,
      refresh_token: json.refresh_token || null,
      expires_in: json.expires_in,
      expires_at: Date.now() + (json.expires_in * 1000),
      saved_at: Date.now()
    };

    await this.storage.put("tokens", data);
    return data;
  }

  async fetch(request) {
    try {
      const url = new URL(request.url);

      if (url.pathname.endsWith("/get")) {
        const tokens = await this.getTokens();
        return new Response(JSON.stringify(tokens || {}), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (url.pathname.endsWith("/set")) {
        const body = await request.json();
        await this.saveTokens(body);

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      /* -----------------------------------------------------
         OAuth state — issued with the authorize redirect and
         consumed once on callback, so a third party cannot
         complete the flow with their own account and take over
         the token store.
      ----------------------------------------------------- */
      /* -----------------------------------------------------
         Reward snapshot — every name and description exactly as
         they were before a bulk rename.

         Written BEFORE the first PATCH, never after. A rename
         that fails halfway is the case this exists for, and a
         snapshot taken at the end would record the damage rather
         than the way back.
      ----------------------------------------------------- */
      /* -----------------------------------------------------
         Alert sample log — real alert payloads, verbatim.

         Raids happen a few times a week and cannot be summoned on
         demand. A test alert is NOT a substitute: the test carries
         username, displayName AND templateData.username, while the
         two real raids we have seen carried none of them. Twice
         now a fix has been reasoned out from the test payload and
         twice it has missed.

         So the real thing gets captured when it happens, and read
         back afterwards.
      ----------------------------------------------------- */
      /* ---------------------------------------------------------
         ⭐ KEEP A QUOTA PER EVENT TYPE, NOT ONE GLOBAL LIST.

         This was a flat "newest 10 wins", which loses precisely
         the events worth capturing. A real 120-Volts send was
         evicted by a burst of ten channel point redemptions
         seconds later, so when the payload was finally needed the
         log held ten copies of the same uninteresting shape and no
         Volts at all.

         Rare events are the whole point of this buffer. A
         redemption happens constantly and its shape is already
         known; a Volts send or a raid might happen twice a stream
         and is exactly what nobody has a sample of.

         So each event type gets its own slots and can only evict
         itself. Redemptions can burst as much as they like now
         without costing us anything else.
      --------------------------------------------------------- */
      if (url.pathname.endsWith("/alerts/sample")) {
        const body = await request.json();
        const log = (await this.storage.get("alert-samples")) || [];

        const entry = { at: Date.now(), ...body };
        const typeOf = (e) => String(e?.event || e?.payload?.event || "unknown");
        const kind = typeOf(entry);

        /* Newest first within a type, and the types keep their
           relative order so the log still reads chronologically
           for anything arriving at a normal rate. */
        const kept = [entry];
        let sameKind = 1;

        for (const old of log) {
          if (typeOf(old) === kind) {
            if (sameKind >= PER_TYPE_SAMPLES) continue;
            sameKind++;
          }
          kept.push(old);
        }

        await this.storage.put("alert-samples", kept.slice(0, MAX_SAMPLES));

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (url.pathname.endsWith("/alerts/log")) {
        const log = (await this.storage.get("alert-samples")) || [];
        return new Response(JSON.stringify(log), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (url.pathname.endsWith("/rewards/snapshot/put")) {
        const body = await request.json();
        await this.storage.put("reward-snapshot", {
          savedAt: Date.now(),
          rewards: body?.rewards || []
        });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (url.pathname.endsWith("/rewards/snapshot/get")) {
        const snap = await this.storage.get("reward-snapshot");
        return new Response(JSON.stringify(snap || null), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (url.pathname.endsWith("/state/put")) {
        const { state } = await request.json();
        await this.storage.put("oauth_state", {
          state,
          created_at: Date.now()
        });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
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

        return new Response(JSON.stringify({ valid }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      return new Response("VeloraTokenStore DO", { status: 200 });
    } catch (err) {
      return new Response("VeloraTokenStore error: " + err.message, {
        status: 500
      });
    }
  }
}

export async function getVeloraTokens(env) {
  const id = env.VeloraTokenStore.idFromName("velora-tokens");
  const stub = env.VeloraTokenStore.get(id);

  const res = await stub.fetch("https://do/get");
  if (!res.ok) return null;

  const json = await res.json();
  return json?.access_token ? json : null;
}

export async function putOAuthState(env, state) {
  const id = env.VeloraTokenStore.idFromName("velora-tokens");
  const stub = env.VeloraTokenStore.get(id);

  await stub.fetch("https://do/state/put", {
    method: "POST",
    body: JSON.stringify({ state })
  });
}

export async function takeOAuthState(env, state) {
  const id = env.VeloraTokenStore.idFromName("velora-tokens");
  const stub = env.VeloraTokenStore.get(id);

  const res = await stub.fetch("https://do/state/take", {
    method: "POST",
    body: JSON.stringify({ state })
  });

  if (!res.ok) return false;

  const json = await res.json();
  return json?.valid === true;
}

export async function saveVeloraTokens(env, json) {
  const id = env.VeloraTokenStore.idFromName("velora-tokens");
  const stub = env.VeloraTokenStore.get(id);

  await stub.fetch("https://do/set", {
    method: "POST",
    body: JSON.stringify(json)
  });
}

/* ---------------------------------------------------------
   Reward snapshot helpers.

   The rollback for a bulk rename. Stored server-side rather than
   handed back for someone to keep safe, because the moment it is
   needed is mid-stream after a rename went wrong — which is
   exactly when nobody wants to be hunting for a file.
--------------------------------------------------------- */
export async function saveRewardSnapshot(env, rewards) {
  const id = env.VeloraTokenStore.idFromName("velora-tokens");
  const stub = env.VeloraTokenStore.get(id);

  const res = await stub.fetch("https://do/rewards/snapshot/put", {
    method: "POST",
    body: JSON.stringify({ rewards })
  });

  return res.ok;
}

export async function getRewardSnapshot(env) {
  const id = env.VeloraTokenStore.idFromName("velora-tokens");
  const stub = env.VeloraTokenStore.get(id);

  try {
    const res = await stub.fetch("https://do/rewards/snapshot/get");
    return await res.json();
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------
   Alert sampling. Fire-and-forget: a failure to record a
   diagnostic must never affect the alert itself.
--------------------------------------------------------- */
export async function sampleAlert(env, entry) {
  try {
    const id = env.VeloraTokenStore.idFromName("velora-tokens");
    await env.VeloraTokenStore.get(id).fetch("https://do/alerts/sample", {
      method: "POST",
      body: JSON.stringify(entry)
    });
  } catch (err) {
    console.warn("[ALERTS] sample failed:", err?.message || err);
  }
}

export async function getAlertSamples(env) {
  try {
    const id = env.VeloraTokenStore.idFromName("velora-tokens");
    const res = await env.VeloraTokenStore.get(id).fetch("https://do/alerts/log");
    return await res.json();
  } catch {
    return [];
  }
}

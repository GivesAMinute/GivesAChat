// givesachat-cloudflare/src/veloraTokenStore.js

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

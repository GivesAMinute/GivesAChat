// givesachat-cloudflare/src/veloraTokenStore.js

export class VeloraTokenStore {
  constructor(state) {
    this.state = state;
    this.storage = state.storage;
  }

  async getTokens() {
    const stored = await this.storage.get("tokens");
    return stored || null;
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

    return new Response("VeloraTokenStore DO", { status: 200 });
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

export async function saveVeloraTokens(env, json) {
  const id = env.VeloraTokenStore.idFromName("velora-tokens");
  const stub = env.VeloraTokenStore.get(id);

  await stub.fetch("https://do/set", {
    method: "POST",
    body: JSON.stringify(json)
  });
}

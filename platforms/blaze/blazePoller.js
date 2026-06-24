// platforms/blaze/blazePoller.js
import axios from "axios";
import { transformBlazeMessage } from "./blazeTransform.js";
import { getBlazeAccessToken, refreshBlazeToken } from "./blazeAuth.js";

export class BlazePoller {
  constructor({ channelId, clientId, intervalMs = 1000, onMessages }) {
    this.channelId = channelId;
    this.clientId = clientId;
    this.intervalMs = intervalMs;
    this.onMessages = onMessages;
    this.timer = null;
    this.running = false;
    this.lastSeenIds = new Set();
  }

  async _ensureValidToken() {
    let token = getBlazeAccessToken();

    // If no token or obviously bad, refresh immediately
    if (!token || token.length < 10) {
      console.log("[BLAZE] No valid token found, refreshing...");
      token = await refreshBlazeToken();
    }

    return token;
  }

  async _fetchMessages() {
    const url = "https://api.blaze.stream/v1/chats/messages";

    const tokenToUse = await this._ensureValidToken();

    const res = await axios.get(url, {
      headers: {
        "client-id": this.clientId,
        Authorization: `Bearer ${tokenToUse}`,
        Accept: "application/json"
      },
      params: {
        channelId: this.channelId,
        limit: 50
      }
    });

    return res.data?.data?.messages || [];
  }

  _filterNew(messages) {
    const fresh = [];

    for (const msg of messages) {
      if (!this.lastSeenIds.has(msg.id)) {
        fresh.push(msg);
        this.lastSeenIds.add(msg.id);
      }
    }

    if (this.lastSeenIds.size > 2000) {
      const ids = Array.from(this.lastSeenIds).slice(-1000);
      this.lastSeenIds = new Set(ids);
    }

    return fresh;
  }

  async _tick() {
    if (!this.running) return;

    try {
      const messages = await this._fetchMessages();
      console.log("[BLAZE] Polled messages:", messages.length);

      const newOnes = this._filterNew(messages);

      if (newOnes.length && this.onMessages) {
        console.log("[BLAZE] New messages to broadcast:", newOnes.length);
        const normalized = newOnes.map(transformBlazeMessage);
        this.onMessages(normalized);
      }
    } catch (err) {
      const status = err?.response?.status;
      const data = err?.response?.data;

      console.error("[BLAZE] Poll error:", status, data || err.message);

      // If unauthorized, try to refresh token
      if (status === 401) {
        console.log("[BLAZE] 401 detected — refreshing token...");
        try {
          await refreshBlazeToken();
        } catch (refreshErr) {
          console.error("[BLAZE] Token refresh failed:", refreshErr);
        }
      }
    }

    if (this.running) {
      this.timer = setTimeout(() => this._tick(), this.intervalMs);
    }
  }

  async start() {
    if (this.running) return;
    this.running = true;

    console.log("[BLAZE] Poller starting…");

    // Make sure we have a valid token before first poll
    await this._ensureValidToken();

    console.log("[BLAZE] Poller started");
    this._tick();
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }
}

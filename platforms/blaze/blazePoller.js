// backend/blaze/blazePoller.js
import axios from "axios";
import { transformBlazeMessage } from "./blazeTransform.js";

export class BlazePoller {
  constructor({ channelId, clientId, accessToken, intervalMs = 1000, onMessages }) {
    this.channelId = channelId;
    this.clientId = clientId;
    this.accessToken = accessToken;
    this.intervalMs = intervalMs;
    this.onMessages = onMessages;
    this.timer = null;
    this.running = false;
    this.lastSeenIds = new Set();
  }

  async _fetchMessages() {
    const url = "https://api.blaze.stream/v1/chats/messages";

    const tokenToUse = globalThis.blazeAccessToken || this.accessToken;

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
      console.error("[BLAZE] Poll error:", err?.response?.status, err?.response?.data || err.message);
    }

    if (this.running) {
      this.timer = setTimeout(() => this._tick(), this.intervalMs);
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    console.log("[BLAZE] Poller started");
    this._tick();
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }
}

// modules/alertRenderer.js

/**
 * Normalize Velora's real alert payload into a simple internal format.
 * Velora uses eventType instead of alertType, and different field names.
 */
function normalizeVeloraAlert(raw) {
  const type = raw.eventType || raw.alertType || "unknown";

  return {
    type,
    username: raw.username || raw.user || raw.sender || "Someone",
    amount: raw.amount || raw.quantity || raw.viewers || null,
    tier: raw.tier || null,
    message: raw.message || null,
    isTest: raw.isTest || false,
    duration: raw.duration || 4 // fallback seconds
  };
}

/**
 * Convert normalized alert into readable text.
 */
function formatVeloraAlert(alert) {
  switch (alert.type) {
    case "follow":
      return `${alert.username} followed!`;

    case "subscription":
    case "sub":
      return `${alert.username} subscribed!`;

    case "gift_subscription":
    case "gift":
      return `${alert.username} gifted ${alert.amount} subs!`;

    case "resub":
    case "resubscription":
      return `${alert.username} resubscribed!`;

    case "raid":
      return `${alert.username} raided with ${alert.amount}!`;

    case "volt_tip":
    case "volts":
      return `${alert.username} sent ${alert.amount} Volts!`;

    default:
      return "Alert!";
  }
}

/**
 * Render the popup alert in the center overlay.
 */
function handleVeloraStreamAlert(rawAlert) {
  const alert = normalizeVeloraAlert(rawAlert);

  const popupRoot = document.getElementById("reward-popup");
  if (!popupRoot) return;

  const el = document.createElement("div");
  el.className = "stream-alert-popup";

  el.innerHTML = `
    <div class="stream-alert-inner">
      <img class="stream-alert-icon" src="/icons/velora.png">
      <div class="stream-alert-text">${formatVeloraAlert(alert)}</div>
    </div>
  `;

  popupRoot.appendChild(el);

  // Auto fade-out
  setTimeout(() => {
    el.classList.add("fade-out");
    setTimeout(() => el.remove(), 800);
  }, alert.duration * 1000);
}

export {
  handleVeloraStreamAlert,
  formatVeloraAlert,
  normalizeVeloraAlert
};

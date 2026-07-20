export function applyExitAnimation(element, duration = 45000) {
  setTimeout(() => {
    element.classList.add("fadeOut");
    setTimeout(() => element.remove(), 600);
  }, duration);
}

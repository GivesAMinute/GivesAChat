export function wrapWithTooltip(innerHTML, label) {
  return `
    <span class="tooltip-wrapper">
      ${innerHTML}
      <span class="tooltip-bubble">${label}</span>
    </span>
  `;
}

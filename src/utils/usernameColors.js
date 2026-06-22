// ---------------------------------------------------------
// USERNAME COLOR — PER SESSION + WEIGHTED PALETTES
// ---------------------------------------------------------

// Generate a session seed once per overlay load
// This ensures colors change each session but stay stable during the session
const SESSION_SEED = Math.floor(Math.random() * 999999);

export function colorForUsername(name, platform) {
  // Stable hash based on username + session seed
  let hash = 0;
  const input = name + SESSION_SEED;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash);

  // Weighted palettes — nicer colors appear more often
  const palettes = {
    twitch: [
      "#9146FF","#9146FF",
      "#A970FF","#A970FF",
      "#B98CFF",
      "#7C4DFF",
      "#9B59FF","#9B59FF",
      "#8E44FF",
      "#A55BFF",
      "#C39BFF",
      "#6E3CE6"
    ],
    youtube: [
      "#FF0000","#FF0000","#FF0000",
      "#FF1A1A","#FF1A1A",
      "#FF3333",
      "#FF4D4D",
      "#FF6666",
      "#E60000",
      "#CC0000"
    ],
    velora: [
      "#F5C451","#F5C451",
      "#F7D06A",
      "#FFD97A",
      "#E8B23A","#E8B23A",
      "#E6A93E",
      "#FFCC66",
      "#FFDB85"
    ],
    kick: [
      "#00FF66","#00FF66","#00FF66",
      "#00E65C",
      "#00CC52",
      "#00B347",
      "#00993D",
      "#00FF7A","#00FF7A",
      "#00FF55"
    ],
    rumble: [
      "#00AA44","#00AA44",
      "#00993D",
      "#008833",
      "#00772A",
      "#00BB55",
      "#00CC66"
    ],
    beam: [
      "#00E0FF","#00E0FF",
      "#33E8FF",
      "#66F0FF",
      "#00C8E6",
      "#00B0CC",
      "#00F2FF"
    ],
    blaze: [
      "#FF8800","#FF8800","#FF8800",
      "#FF9C33","#FF9C33",
      "#FFB566",
      "#FF7A00","#FF7A00",
      "#E66F00",
      "#CC6400"
    ]
  };

  const palette = palettes[platform];
  if (palette) return palette[index % palette.length];

  // Fallback rainbow
  const hue = index % 360;
  return `hsl(${hue}, 70%, 60%)`;
}


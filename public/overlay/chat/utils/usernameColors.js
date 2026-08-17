// ---------------------------------------------------------
// USERNAME COLOR — PER SESSION + WEIGHTED PALETTES
//
// Every platform gets a palette drawn from its own brand
// colours, so a name is always tinted in the colours of the
// platform it came from.
//
// The palettes added for vpzone, arena, pilled, odysee,
// bitchute and nimotv were sampled directly from the icon PNGs
// in public/icons/ — the most common non-grey, non-transparent
// colours in each mark, plus lighter and darker variants for
// variety. So VPZONE names are its pink and blues, Arena's are
// its orange, and so on. The older palettes above them were
// hand-tuned and are left as they are.
//
// Weighting is by repetition: a colour listed three times is
// three times as likely, which keeps the primary brand colour
// dominant while still giving the lane variety.
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
    ],

    vpzone: [
      "#F9266C","#F9266C","#F9266C",
      "#FF276F","#FF276F","#DA215F",
      "#F9588D","#558DF9","#558DF9",
      "#5790FF","#4B7CDA","#60ABFB",
      "#60ABFB","#62AEFF","#5496DC",
    ],
    arena: [
      "#EA5209","#EA5209","#EA5209",
      "#FF590A","#FF590A","#CB4708",
      "#EA7238","#E3530B","#E3530B",
      "#FC5C0C","#C4480A","#D45A1C",
      "#D45A1C","#EE651F","#B54D18",
    ],
    pilled: [
      "#0091CB","#0091CB","#0091CB",
      "#00A3E4","#00A3E4","#007BAC",
      "#299DCB","#00B6DE","#00B6DE",
      "#00CBF8","#009DBF","#005073",
      "#005073","#00628C","#003B54",
    ],
    odysee: [
      "#F67737","#F67737","#F67737",
      "#FF7B39","#FF7B39","#D76830",
      "#F69868","#F98D2A","#F98D2A",
      "#FF902B","#DA7C25","#F24259",
      "#F24259","#FF465E","#D33A4E",
    ],
    bitchute: [
      "#FC1408","#FC1408","#FC1408",
      "#FF1408","#FF1408","#DD1207",
      "#FC443A",
    ],
    nimotv: [
      "#622CF6","#622CF6","#622CF6",
      "#662EFF","#662EFF","#5627D7",
      "#865DF6","#7E53F6","#7E53F6",
      "#8356FF","#6E49D7","#FED700",
      "#FED700","#FFD800","#DFBD00",
    ],
  };

  const palette = palettes[platform];
  if (palette) return palette[index % palette.length];

  /* Unknown platform — Beam can relay one we have no palette
     for. A readable spread of hues beats a broken lookup, and
     the console note makes the gap visible so a palette can be
     added from that platform's icon. */
  if (platform) console.debug("[Overlay] no colour palette for platform:", platform);

  const hue = index % 360;
  return `hsl(${hue}, 70%, 60%)`;
}

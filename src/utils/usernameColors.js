export function colorForUsername(name, platform) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash);

  const palettes = {
    twitch: ["#9146FF","#A970FF","#B98CFF","#7C4DFF","#9B59FF","#8E44FF","#A55BFF","#C39BFF","#6E3CE6","#B084FF","#9F6BFF","#7A3FE6"],
    youtube: ["#FF0000","#FF1A1A","#FF3333","#FF4D4D","#FF6666","#E60000","#CC0000","#FF5E57","#FF2D55","#FF3B30","#FF6A6A","#FF7F7F"],
    velora: ["#F5C451","#F7D06A","#FFD97A","#E8B23A","#E6A93E","#FFCC66","#FFDB85","#F2B94F","#DFA63A","#F8D88C","#E4B75A","#F0C76E"],
    kick: ["#00FF66","#00E65C","#00CC52","#00B347","#00993D","#00FF7A","#00FF55","#00E64D","#00CC44","#00B33A","#00FF88","#00FF99"],
    rumble: ["#00AA44","#00993D","#008833","#00772A","#006622","#00BB55","#00CC66","#00994D","#008040","#007338","#00D46A","#00C45C"],
    beam: ["#00E0FF","#33E8FF","#66F0FF","#00C8E6","#00B0CC","#00F2FF","#4DF6FF","#80FAFF","#00D4E6","#00BED1","#00E8F2","#33F0FF"],
    blaze: ["#FF8800","#FF9C33","#FFB566","#FF7A00","#E66F00","#CC6400","#FF9933","#FFB266","#FF8C1A","#FF751A","#E67300","#CC6600"]
  };

  const palette = palettes[platform];
  if (palette) return palette[index % palette.length];

  const hue = index % 360;
  return `hsl(${hue}, 70%, 60%)`;
}

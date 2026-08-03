import sharp from "sharp";
import fs from "fs";

async function renderMOD() {
  const svg = fs.readFileSync("public/badges/blaze/mod.svg");

  await sharp(svg)
    .png()
    .toFile("public/badges/blaze/mod.png");

  console.log("Rendered MOD badge");
}

renderMOD();

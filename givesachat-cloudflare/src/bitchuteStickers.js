// givesachat-cloudflare/src/bitchuteStickers.js

/* ---------------------------------------------------------
   BitChute sticker manifest

   Transcribed from BitChute's own client bundle, where the list
   is a hardcoded array of { key, setKey, url }. The KEY is what
   matters: it is the token that appears in a message's content.

     content: "nice one [trump-3]"

   So stickers are inline text substitutions, the same shape as
   Odysee's :token: — not a separate event type.

   Six sets, 59 stickers. Two of them are content-addressed
   and four are not, which is why the manifest is necessary:

     [rhg-1]    11dccf04…a919.png        sha256 filename
     [liz-1]    20dc0be6…97dd.png        sha256 filename
     [trump-1]  stickers/trump/Trump-01.webp
     [sheep-1]  stickers/sheep/Sheep-01.webp
     [jeff-1]   stickers/jeff/Jeff-stickers-01.webp
     [ray-1]    stickers/ray/Ray-sticker-01.webp

   The named sets follow a pattern and could be derived. The
   hashed ones cannot — nothing in "[rhg-1]" leads to that
   filename. Both are listed rather than half-derived, because a
   rule covering two thirds of the cases is exactly how the
   Odysee integration stayed broken for six rounds.

   Note the prefixes disagree with each other: "Jeff-stickers-01"
   but "Ray-sticker-01" (singular), and "Trump-01" with no suffix.
   Generated from their data, so those are faithful.
--------------------------------------------------------- */

const CDN = "https://rant-cdn.bitchute.com/";

/* key (as it appears in message content) -> path under the CDN */
const STICKERS = {
  "[rhg-1]":      "11dccf0473742e48304aa677bd72dc65eca08e6aaccbb84da206a1eed2eaa919.png",
  "[rhg-2]":      "af6b109e5580fec194640e9c2dd08eb152bb12e605683b9978d302f78f0dee56.png",
  "[rhg-3]":      "518d7ca1e34449b95639451028b19607efa7b32f8e2b65c2a30891170bc5f3c6.png",
  "[rhg-4]":      "d33db7e2dd1bf4b92aeceb1707e49cc1f340eab9f6d9380bb6f2cd686f54904c.png",
  "[rhg-5]":      "6a1941676c9ab9db3f17cae74ef41f5b729305c8afba9921177c46c2a4bc28ad.png",
  "[rhg-6]":      "dab38727509a892e63723349d1c28338a07d7b922092bc8b29e11ec1c7367086.png",
  "[rhg-7]":      "7aa42bb6a4e0daa39eb909c475674691fc972fe9174937fb61b1be10a3fff6b9.png",
  "[rhg-8]":      "f5da58da8eafb8e71d60d863fc91ab793017d27ea2077adbcef5e75c79e9352d.png",
  "[liz-1]":      "20dc0be605861f9f07a9e316064c647858d643ff4829a602b5c201896e6297dd.png",
  "[liz-2]":      "4ef629cd06a499d40f2b4ee4985f85fc8049c051ba470d60a3ad31bcd8c38294.png",
  "[liz-3]":      "6023cbd71b0a8a13be26f0437a6e084479688abb5ec826289406c5cea11a5c13.png",
  "[liz-4]":      "77533663543ed7d9b48f6c659cbc672f28a11764954dbb28875144c14a354b7e.png",
  "[liz-5]":      "8998e72d01c0330ddfaced2abc4d985c65a5a7c130d960ff217c0f8ff7d347e9.png",
  "[liz-6]":      "a8e5b7f0f5c47c7508543b809f533484d764cebd375ac29b82cb93a86aa3c05e.png",
  "[liz-7]":      "c676cd6928e05dcd89c21fdba733f356d48b418752ca73b4207a49ba8bd5b87e.png",
  "[liz-8]":      "e627cf3101dc3a1ab8235af2b27ecefc33a4bde09430f9b73ac5841be44972fc.png",
  "[trump-1]":    "stickers/trump/Trump-01.webp",
  "[trump-2]":    "stickers/trump/Trump-02.webp",
  "[trump-3]":    "stickers/trump/Trump-03.webp",
  "[trump-4]":    "stickers/trump/Trump-04.webp",
  "[trump-5]":    "stickers/trump/Trump-05.webp",
  "[trump-6]":    "stickers/trump/Trump-06.webp",
  "[trump-7]":    "stickers/trump/Trump-07.webp",
  "[trump-8]":    "stickers/trump/Trump-08.webp",
  "[sheep-1]":    "stickers/sheep/Sheep-01.webp",
  "[sheep-2]":    "stickers/sheep/Sheep-02.webp",
  "[sheep-3]":    "stickers/sheep/Sheep-03.webp",
  "[sheep-4]":    "stickers/sheep/Sheep-04.webp",
  "[sheep-5]":    "stickers/sheep/Sheep-05.webp",
  "[sheep-6]":    "stickers/sheep/Sheep-06.webp",
  "[sheep-7]":    "stickers/sheep/Sheep-07.webp",
  "[sheep-8]":    "stickers/sheep/Sheep-08.webp",
  "[sheep-9]":    "stickers/sheep/Sheep-09.webp",
  "[sheep-10]":   "stickers/sheep/Sheep-10.webp",
  "[sheep-11]":   "stickers/sheep/Sheep-11.webp",
  "[sheep-12]":   "stickers/sheep/Sheep-12.webp",
  "[sheep-13]":   "stickers/sheep/Sheep-13.webp",
  "[sheep-14]":   "stickers/sheep/Sheep-14.webp",
  "[sheep-15]":   "stickers/sheep/Sheep-15.webp",
  "[sheep-16]":   "stickers/sheep/Sheep-16.webp",
  "[sheep-17]":   "stickers/sheep/Sheep-17.webp",
  "[sheep-18]":   "stickers/sheep/Sheep-18.webp",
  "[sheep-19]":   "stickers/sheep/Sheep-19.webp",
  "[jeff-1]":     "stickers/jeff/Jeff-stickers-01.webp",
  "[jeff-2]":     "stickers/jeff/Jeff-stickers-02.webp",
  "[jeff-3]":     "stickers/jeff/Jeff-stickers-03.webp",
  "[jeff-4]":     "stickers/jeff/Jeff-stickers-04.webp",
  "[jeff-5]":     "stickers/jeff/Jeff-stickers-05.webp",
  "[jeff-6]":     "stickers/jeff/Jeff-stickers-06.webp",
  "[jeff-7]":     "stickers/jeff/Jeff-stickers-07.webp",
  "[jeff-8]":     "stickers/jeff/Jeff-stickers-08.webp",
  "[ray-1]":      "stickers/ray/Ray-sticker-01.webp",
  "[ray-2]":      "stickers/ray/Ray-sticker-02.webp",
  "[ray-3]":      "stickers/ray/Ray-sticker-03.webp",
  "[ray-4]":      "stickers/ray/Ray-sticker-04.webp",
  "[ray-5]":      "stickers/ray/Ray-sticker-05.webp",
  "[ray-6]":      "stickers/ray/Ray-sticker-06.webp",
  "[ray-7]":      "stickers/ray/Ray-sticker-07.webp",
  "[ray-8]":      "stickers/ray/Ray-sticker-08.webp"
};

/* Bracketed tokens: [set-N]. Matched strictly — the result goes
   into a src attribute and message content is user-supplied. */
export const BITCHUTE_STICKER_TOKEN = /\[[a-z]+-\d{1,3}\]/gi;

/**
 * @param {string} key  e.g. "[trump-3]", case-insensitive
 * @returns {string|null} full CDN URL, or null if unknown
 */
export function bitchuteSticker(key) {
  const path = STICKERS[String(key).toLowerCase()];
  return path ? CDN + path : null;
}

export const BITCHUTE_STICKER_COUNT = 59;

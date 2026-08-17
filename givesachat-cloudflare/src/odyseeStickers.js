// givesachat-cloudflare/src/odyseeStickers.js

/* ---------------------------------------------------------
   Odysee sticker manifest

   Transcribed from Odysee's own web client bundle, where the
   full list is a hardcoded array built by a helper:

     const url = (path) => `https://static.odycdn.com/stickers/${path}`;
     const S = (name, path, price) => ({ name: `:${name}:`, url: url(path), price });

   This is why probing could never solve stickers. There is no
   scheme to infer — the list is static data compiled into the
   client, and the paths were named by hand:

     :PISS:            PISS/PNG/piss_with_frame.png
     :WHUUT:           WHUUT/PNG/whuut_with-frame.png     (hyphen)
     :BRAVO:           MISC/PNG/bravo.png                 (shared pack)
     :THUG_LIFE:       THUG%20LIFE/PNG/thug_life_with_border_clean.png
     :SPHAGETTI_BATH:  SPHAGETTI%20BATH/PNG/sphagetti%20bath_with_frame.png
     :SICK_SKULL:      SICK/PNG/with%20borderdark%20with%20frame.png

   Note SICK_SKULL: the filename contains nothing from the
   token. No rule reaches that. Only the manifest does.

   Note also PANTS_1 — an ALL-CAPS token ending in _1. It is a
   sticker, not a numbered emote variant, which is why sticker
   lookup has to run before the emote `_N` suffix handling for
   uppercase tokens.

   Paths are stored exactly as the client emits them, already
   percent-encoded where they contain spaces.

   BEING A SNAPSHOT, THIS CAN GO STALE. A token that isn't here
   still falls through to OdyseeRoom's candidate probing, so a
   newly added sticker degrades to the old guess-and-check
   behaviour rather than to nothing.
--------------------------------------------------------- */

const CDN = "https://static.odycdn.com/stickers/";

/* Free stickers. */
const FREE = {
  FIRE:                "MISC/PNG/fire.png",
  SLIME:               "SLIME/PNG/slime_with_frame.png",
  PISS:                "PISS/PNG/piss_with_frame.png",
  THUMBS_UP:           "MISC/PNG/thumbs_up.png",
  BRAVO:               "MISC/PNG/bravo.png",
  WOW:                 "MISC/PNG/wow.png",
  GRR:                 "MISC/PNG/grr.png",
  ACTUALLY:            "MISC/PNG/actually.png",
  INTERESTING:         "MISC/PNG/interesting.png",
  CAT:                 "CAT/PNG/cat_with_border.png",
  FAIL:                "FAIL/PNG/fail_with_border.png",
  HYPE:                "HYPE/PNG/hype_with_border.png",
  PANTS_1:             "PANTS/PNG/PANTS_1_with_frame.png",
  DOGE:                "MISC/PNG/doge.png",
  EGG_CARTON:          "MISC/PNG/egg_carton.png",
  WAITING:             "MISC/PNG/waiting.png",
  BULL_RIDE:           "BULL/PNG/bull-ride.png",
  ELIMINATED:          "ELIMINATED/PNG/eliminated.png",
  BAN:                 "BAN/PNG/ban.png",
  MONEY_PRINTER:       "MISC/PNG/money_printer.png",
  MOUNT_RUSHMORE:      "MISC/PNG/mount_rushmore.png",
  KANYE_WEST:          "MISC/PNG/kanye_west.png",
  TAYLOR_SWIFT:        "MISC/PNG/taylor_swift.png",
  DONALD_TRUMP:        "MISC/PNG/donald_trump.png",
  BILL_CLINTON:        "MISC/PNG/bill_clinton.png",
  EPSTEIN_ISLAND:      "MISC/PNG/epstein_island.png",
  KURT_COBAIN:         "MISC/PNG/kurt_cobain.png",
  BILL_COSBY:          "MISC/PNG/bill_cosby.png",
  CHE_GUEVARA:         "MISC/PNG/che_guevara.png",
  PREGNANT_MAN_BLONDE: "pregnant%20man/png/Pregnant%20man_white%20border_blondie.png",
  ROCKET_SPACEMAN:     "ROCKET%20SPACEMAN/PNG/rocket-spaceman_with-border.png",
  SALTY:               "SALTY/PNG/salty.png",
  SICK_FLAME:          "SICK/PNG/sick2_with_border.png",
  SICK_SKULL:          "SICK/PNG/with%20borderdark%20with%20frame.png",
  SPHAGETTI_BATH:      "SPHAGETTI%20BATH/PNG/sphagetti%20bath_with_frame.png",
  THUG_LIFE:           "THUG%20LIFE/PNG/thug_life_with_border_clean.png",
  TRAP:                "TRAP/PNG/trap.png",
  TRASH:               "TRASH/PNG/trash.png",
  WHUUT:               "WHUUT/PNG/whuut_with-frame.png"
};

/* ---------------------------------------------------------
   Paid stickers — these cost LBC/USD to send, so one of these
   in chat means someone tipped you. The price is carried
   through on the payload so the overlay can treat them
   differently later if you want (a tip card, a sound, a
   bigger render). Nothing uses it yet.
--------------------------------------------------------- */
const PAID = {
  TIP_HAND_FLIP:       ["TIPS/png/tip_hand_flip_$%20_with_border.png", 1],
  TIP_HAND_FLIP_COIN:  ["TIPS/png/tip_hand_flip_coin_with_border.png", 1],
  TIP_HAND_FLIP_LBC:   ["TIPS/png/tip_hand_flip_lbc_with_border.png", 1],
  COMET_TIP:           ["TIPS/png/$%20comet%20tip%20with%20border.png", 5],
  SILVER_ODYSEE_COIN:  ["TIPS/png/with%20bordersilver_odysee_coinv.png", 5],
  LBC_COMET_TIP:       ["TIPS/png/LBC%20comet%20tip%20with%20border.png", 25],
  SMALL_TIP:           ["TIPS/png/with%20bordersmall$_tip.png", 25],
  SMALL_LBC_TIP:       ["TIPS/png/with%20bordersmall_LBC_tip%20.png", 25],
  BITE_TIP:            ["TIPS/png/bite_$tip_with%20border.png", 50],
  BITE_TIP_CLOSEUP:    ["TIPS/png/bite_$tip_closeup.png", 50],
  BITE_LBC_CLOSEUP:    ["TIPS/png/LBC%20bite.png", 50],
  MEDIUM_TIP:          ["TIPS/png/with%20bordermedium$_%20tip.png", 50],
  MEDIUM_LBC_TIP:      ["TIPS/png/with%20bordermedium_LBC_tip%20%20%20%20%20%20%20%20%20%20.png", 50],
  LARGE_TIP:           ["TIPS/png/with%20borderlarge$tip.png", 100],
  LARGE_LBC_TIP:       ["TIPS/png/with%20borderlarge_LBC_tip%20.png", 100],
  BIG_TIP:             ["TIPS/png/with%20borderbig$tip.png", 150],
  BIG_LBC_TIP:         ["TIPS/png/big_LBC_TIPV.png", 150],
  FORTUNE_CHEST:       ["TIPS/png/with%20borderfortunechest$_tip.png", 200],
  FORTUNE_CHEST_LBC:   ["TIPS/png/with%20borderfortunechest_LBC_tip.png", 200]
};

const STICKERS = new Map();

for (const [name, path] of Object.entries(FREE)) {
  STICKERS.set(name, { kind: "sticker", url: CDN + path, price: 0 });
}

for (const [name, [path, price]] of Object.entries(PAID)) {
  STICKERS.set(name, { kind: "sticker", url: CDN + path, price });
}

/**
 * @param {string} name  a :TOKEN: with the colons stripped
 * @returns {{kind:"sticker", url:string, price:number}|null}
 */
export function odyseeSticker(name) {
  return STICKERS.get(name) || null;
}

export const ODYSEE_STICKER_COUNT = STICKERS.size;

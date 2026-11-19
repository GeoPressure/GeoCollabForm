// Species illustrations from huashu-bird-sticker (https://github.com/alchaincyf/huashu-bird-sticker),
// AI-generated stickers, CC BY 4.0. Files follow stickers/<Order>/<Family>/<Genus_species>.webp;
// species where that rule fails are listed in bird_sticker_overrides.json
// (rebuild with scripts/build_sticker_overrides.py).
import overrides from "../data/bird_sticker_overrides.json";

const STICKER_CDN = "https://cdn.jsdelivr.net/gh/alchaincyf/huashu-bird-sticker@main/";

export const BIRD_STICKER_REPO_URL = "https://github.com/alchaincyf/huashu-bird-sticker";

export function birdStickerUrl(species) {
  if (!species?.scientific_name) return "";
  const name = species.scientific_name;
  const file = Object.hasOwn(overrides, name)
    ? overrides[name]
    : `stickers/${species.order_name}/${species.family_name}/${name.replace(/ /g, "_")}.webp`;
  return file ? STICKER_CDN + file : "";
}

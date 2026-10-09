import { createCn } from "cn/config"

/**
 * Class merging that knows the app's own text sizes (`text-body`, `text-meta`,
 * `text-transcript`, `text-title` from index.css). Without this, a size class
 * was taken for a text colour and silently removed the colour next to it (for
 * example the dark text on filled buttons).
 */
export const cn = createCn({
  extend: { classGroups: { "font-size": [{ text: ["body", "meta", "transcript", "title"] }] } },
})

"use client";

import { useEffect } from "react";

/**
 * Scroll to the element named in the address's #hash once this screen's
 * content is on the page.
 *
 * Next tries that scroll when the navigation commits, but the loading skeleton
 * is showing then and the element does not exist yet, so a link such as
 * /me#notifications would stop at the top. Render this inside the content that
 * holds the target; give the target a `scroll-mt-*` so it clears the top bar.
 */
export function ScrollToHash() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, []);
  return null;
}

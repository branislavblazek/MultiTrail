/**
 * Whether the page is open in author mode, which is what the layer panel and
 * everything around publishing is for. Plain visitors only get the map and
 * the recommended trails.
 *
 * This only hides the tools, it guards nothing: the data files are public
 * either way, so anyone who adds the parameter gets the same panel.
 * @returns {boolean}
 */
export function isAuthor() {
  const value = new URLSearchParams(location.search).get("author");

  return value !== null && value !== "false";
}

/**
 * Drops every element marked as author-only from the page.
 */
export function removeAuthorOnly() {
  for (const el of document.querySelectorAll("[data-author]")) el.remove();
}

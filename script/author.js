/**
 * Whether the page is open in author mode, which is what publishing a trail
 * needs. Everything else, the layer panel included, is there for everyone.
 *
 * This only hides the tools, it guards nothing: the data files are public
 * either way, so anyone who adds the parameter gets the same buttons.
 * @returns {boolean}
 */
export function isAuthor() {
  const value = new URLSearchParams(location.search).get("author");

  return value !== null && value !== "false";
}

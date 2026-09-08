/**
 * Whether the page is open in author mode, which is what publishing a trail
 * needs. Everything else, the layer panel included, is there for everyone.
 *
 * This only hides the tools, it guards nothing: the data files are public
 * either way, so anyone who adds the parameter gets the same buttons.
 * @returns {boolean}
 */
let decided = null;

export function isAuthor() {
  // Decided once, on the url the page was opened with: the app rewrites the
  // url while it runs and the mode must not flip midway
  if (decided === null) {
    const value = new URLSearchParams(location.search).get("author");
    decided = value !== null && value !== "false";
  }

  return decided;
}

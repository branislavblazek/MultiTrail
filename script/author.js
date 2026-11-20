/** Where the app runs when it is opened from the machine it is authored on. */
const LOCAL = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Whether the page is open on the author's own machine. That alone switches
 * the authoring tools on: publishing from the layer panel, and the admin
 * editor when its server is there. Nothing in the url does, so on the public
 * site they cannot be asked for.
 *
 * This only hides the tools, it guards nothing: the data files are public
 * either way, and writing them takes the local admin server.
 * @returns {boolean}
 */
export function isAuthor() {
  return LOCAL.includes(location.hostname);
}

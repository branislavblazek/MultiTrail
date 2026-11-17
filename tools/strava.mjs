// Strava for the admin server: the track of an activity, so its gpx does not
// have to be downloaded by hand.
//
// An embed code cannot do that. Strava answers it with a ready picture of the
// map and nothing else, and the page of an activity holds no points either
// unless its owner is signed in. What does hand the points over is the
// official API, to the athlete the activity belongs to.
//
// That takes two things, once: an API application of the author's own
// (https://www.strava.com/settings/api, callback domain "localhost"), and
// their consent to read activities through it. Both are kept in
// ~/.config/multitrail/strava.json, outside the project, where they can
// neither be committed nor served.

import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Where Strava is. Tests point it at a stand-in. */
const ORIGIN = process.env.MULTITRAIL_STRAVA_ORIGIN ?? "https://www.strava.com";

const STORE = join(homedir(), ".config/multitrail/strava.json");

/** Covers activities kept to "Only You", and the hidden start and end. */
const SCOPE = "activity:read_all";

/** What the editor has to get from the author before a track can come. */
const NEEDS_CREDENTIALS = "credentials";
const NEEDS_CONSENT = "connect";

/** The consent under way: what Strava has to send back, and where to. */
let pending = null;

/**
 * Keeps the API application of the author. A consent given to another
 * application is of no use to this one, so it goes.
 * @param {*} body
 * @param {string} body.client_id
 * @param {string} body.client_secret
 */
export async function saveCredentials({ client_id, client_secret }) {
  const id = String(client_id ?? "").trim();
  const secret = String(client_secret ?? "").trim();

  if (!/^\d+$/.test(id)) throw fail(400, "Client ID má byť číslo.");
  if (!secret) throw fail(400, "Chýba Client Secret.");

  await store({ client_id: id, client_secret: secret });
}

/**
 * The address at Strava where the author gives their consent.
 * @param {string} redirectUri where Strava sends them back, on this server
 * @returns {Promise<string>}
 */
export async function authorizeUrl(redirectUri) {
  const { client_id } = await credentials();

  pending = { state: randomBytes(16).toString("hex"), redirectUri };

  const url = new URL("/oauth/authorize", ORIGIN);
  url.search = new URLSearchParams({
    client_id,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: SCOPE,
    state: pending.state,
  });

  return url.href;
}

/**
 * Finishes the consent Strava sent the author back with.
 * @param {URLSearchParams} query what Strava put on the address
 */
export async function finishConnect(query) {
  if (!pending || query.get("state") !== pending.state) {
    throw fail(400, "Toto pripojenie nezačalo v editore. Skús to z neho znova.");
  }

  pending = null; // Strava's answer came, whatever it is

  if (query.get("error") || !query.get("code")) {
    throw fail(403, "Strava prístup nepovolila.");
  }

  // The author may untick what was asked for
  if (!/\bactivity:read(_all)?\b/.test(query.get("scope") ?? "")) {
    throw fail(
      403,
      "Bez povolenia čítať aktivity sa trasa stiahnuť nedá. Skús to znova a " +
        "nechaj ho zaškrtnuté.",
    );
  }

  const settings = await credentials();
  const tokens = await token(settings, {
    grant_type: "authorization_code",
    code: query.get("code"),
  });

  await store({ ...settings, ...tokens });
}

/**
 * The recorded points of an activity.
 * @param {string} id the activity id
 * @returns {Promise<{ id: string, name: string, coords: number[][] }>}
 *   coords as [lng, lat, ele], or [lng, lat] where no altitude was recorded
 */
export async function activityTrack(id) {
  if (!/^\d+$/.test(id)) throw fail(400, `„${id}“ nie je ID aktivity.`);

  const access = await accessToken();

  const [streams, activity] = await Promise.all([
    get(`/api/v3/activities/${id}/streams?keys=latlng,altitude&key_by_type=true`, access, id),
    // Only the name comes from here, a track is worth having without it
    get(`/api/v3/activities/${id}`, access, id).catch(() => null),
  ]);

  // Keyed by type as asked for; the API also knows an older answer, a list
  const byType = Array.isArray(streams)
    ? Object.fromEntries(streams.map((stream) => [stream.type, stream]))
    : streams;

  const points = byType?.latlng?.data;
  const altitudes = byType?.altitude?.data ?? [];

  if (!Array.isArray(points) || points.length < 2) {
    throw fail(422, "Táto aktivita nemá GPS záznam.");
  }

  const coords = points.map(([lat, lng], index) => {
    const ele = altitudes[index];

    return Number.isFinite(ele) ? [lng, lat, ele] : [lng, lat];
  });

  if (!coords.every(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))) {
    throw fail(502, "Strava poslala záznam, ktorému nerozumiem.");
  }

  return { id, name: String(activity?.name ?? "").trim(), coords };
}

/**
 * A token the API takes right now. They last six hours, so most of the time
 * the stored one has to be traded for a fresh one first.
 * @returns {Promise<string>}
 */
async function accessToken() {
  const settings = await credentials();

  if (!settings.refresh_token) {
    throw fail(409, "Strava ešte nie je pripojená.", NEEDS_CONSENT);
  }

  if (settings.access_token && settings.expires_at - 60 > Date.now() / 1000) {
    return settings.access_token;
  }

  const tokens = await token(settings, {
    grant_type: "refresh_token",
    refresh_token: settings.refresh_token,
  });

  await store({ ...settings, ...tokens });

  return tokens.access_token;
}

/**
 * Trades a consent, or the refresh token of an earlier one, for tokens.
 * @param {*} settings what is stored, credentials at least
 * @param {*} grant the grant type and what it is granted for
 * @returns {Promise<{ access_token: string, refresh_token: string, expires_at: number }>}
 */
async function token(settings, grant) {
  const { client_id, client_secret } = settings;

  const response = await reach("/oauth/token", {
    method: "POST",
    body: new URLSearchParams({ client_id, client_secret, ...grant }),
  });
  const answer = await response.json().catch(() => ({}));

  if (response.ok && answer.access_token && answer.refresh_token) {
    const { access_token, refresh_token, expires_at } = answer;

    return { access_token, refresh_token, expires_at };
  }

  if (response.status === 429) throw limited();

  // Strava names what it did not like
  if (answer.errors?.some((error) => error.resource === "Application")) {
    await store({});

    throw fail(
      409,
      "Strava nepozná toto Client ID alebo Client Secret. Zadaj ich znova.",
      NEEDS_CREDENTIALS,
    );
  }

  if (response.status >= 500) throw fail(502, `Strava odpovedala ${response.status}.`);

  // What is left is the consent itself: used up, withdrawn or expired
  await store({ client_id, client_secret });

  throw fail(409, "Pripojenie k Strave už neplatí. Pripoj ju znova.", NEEDS_CONSENT);
}

/**
 * Asks the API.
 * @param {string} path
 * @param {string} access the access token
 * @param {string} id the activity asked about, for the complaints
 * @returns {Promise<*>} the json it answered with
 */
async function get(path, access, id) {
  const response = await reach(path, {
    headers: { Authorization: `Bearer ${access}` },
  });

  if (response.ok) return response.json();

  if (response.status === 401) {
    const { client_id, client_secret } = await load();
    await store({ client_id, client_secret });

    throw fail(
      409,
      "Strava prístup odmietla: bol zrušený, alebo mu chýba povolenie čítať " +
        "aktivity. Pripoj ju znova.",
      NEEDS_CONSENT,
    );
  }

  if (response.status === 404) {
    throw fail(404, `Aktivitu ${id} Strava nenašla. Stiahnuť sa dá len tvoja vlastná.`);
  }

  if (response.status === 429) throw limited();

  throw fail(502, `Strava odpovedala ${response.status}.`);
}

/**
 * A request to Strava, with the failure to reach it at all put into words.
 * @param {string} path
 * @param {*} options for fetch
 * @returns {Promise<Response>}
 */
async function reach(path, options) {
  try {
    return await fetch(new URL(path, ORIGIN), options);
  } catch {
    throw fail(502, "Strava neodpovedá. Si pripojený na internet?");
  }
}

/**
 * The stored credentials, or the complaint that there are none yet.
 * @returns {Promise<*>} everything stored
 */
async function credentials() {
  const settings = await load();

  if (!settings.client_id || !settings.client_secret) {
    throw fail(409, "Strava ešte nie je nastavená.", NEEDS_CREDENTIALS);
  }

  return settings;
}

async function load() {
  try {
    return JSON.parse(await readFile(STORE, "utf8")) ?? {};
  } catch {
    return {}; // Not there yet, or not json: both mean starting over
  }
}

/**
 * Writes the settings where only their owner can read them.
 * @param {*} settings
 */
async function store(settings) {
  await mkdir(dirname(STORE), { recursive: true });
  await writeFile(STORE, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  await chmod(STORE, 0o600); // The mode above only counts for a new file
}

function limited() {
  return fail(429, "Strava má na chvíľu dosť požiadaviek. Skús to o štvrť hodiny.");
}

/**
 * An error that knows its http status, and what the author has to do first
 * when that is what it is about.
 * @param {number} status
 * @param {string} message
 * @param {string} [needs]
 * @returns {Error}
 */
function fail(status, message, needs) {
  return Object.assign(new Error(message), { status, needs });
}

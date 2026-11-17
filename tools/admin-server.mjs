#!/usr/bin/env node
// Local server for authoring. It serves the app the way any static server
// would, and adds the few endpoints the editor in the app writes trails
// through: trails.geojson, the gpx and the photo, all under data/. It also
// fetches the track of a Strava activity for the editor (tools/strava.mjs).
//
// Usage: node tools/admin-server.mjs          (http://localhost:8000)
//        node tools/admin-server.mjs 8010     (another port)
//
// Admin mode in the app turns itself on when the app is opened through this
// server. Production has no such endpoints, so the editor never loads there.
//
// No dependencies, just Node. It listens on 127.0.0.1 only, so nothing else
// on the network can reach it.

import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  activityTrack,
  authorizeUrl,
  finishConnect,
  saveCredentials,
} from "./strava.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOST = "127.0.0.1";
const PORT = Number(process.argv[2] ?? process.env.PORT) || 8000;

const TRAILS = join(ROOT, "data/trails.geojson");
const PHOTO_SOURCE = join(ROOT, "data/images/tmp.jpg");
const PHOTO_TOOL = join(ROOT, "tools/reduce-photo.sh");

/** The same shape tools/reduce-photo.sh insists on. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Sent by the editor with every write. A foreign page cannot add it without
    a CORS preflight, and that preflight is never answered here. */
const WRITE_HEADER = "x-multitrail-admin";

/** The editor listens here for the Strava consent to come through. */
const STRAVA_CHANNEL = "multitrail-strava";

/** Line width trails.geojson is wrapped to, the Prettier default. */
const PRINT_WIDTH = 80;

const MEGABYTE = 1024 * 1024;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".gpx": "application/gpx+xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

const run = promisify(execFile);

const gpxPath = (slug) => join(ROOT, "data/trails", `${slug}.gpx`);
const imageFolder = (slug) => join(ROOT, "data/images", slug);

const server = createServer(async (req, res) => {
  try {
    // A page on another origin could still aim a request at localhost, and
    // a rebound DNS name would even look same-origin to the browser
    if (!isLocalHost(req.headers.host)) throw fail(403, "Len pre localhost");

    const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);

    if (path.startsWith("/api/")) await api(req, res, path);
    else await serveFile(req, res, path);
  } catch (err) {
    const status = err.status ?? (err instanceof URIError ? 400 : 500);
    if (status === 500) console.error(err);

    // "needs" is what the editor has to get from the author first
    sendJson(res, status, { error: err.message, needs: err.needs });
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} je obsadený. Skús iný: node tools/admin-server.mjs ${PORT + 10}`,
    );
    process.exit(1);
  }

  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`MultiTrail admin beží na http://localhost:${PORT}`);
  console.log(`Zapisuje do ${join(ROOT, "data")}`);
  console.log("Ctrl+C ho ukončí");
});

/**
 * The admin endpoints.
 * @param {*} req
 * @param {*} res
 * @param {string} path decoded pathname, starting with /api/
 */
async function api(req, res, path) {
  const [, , resource, ...parts] = path.split("/");

  if (resource === "admin" && !parts.length && req.method === "GET") {
    return sendJson(res, 200, { admin: true });
  }

  if (resource === "strava") return strava(req, res, parts);

  const [slug, part, ...rest] = parts;

  if (resource !== "trails" || !slug || rest.length) throw fail(404, "Not found");
  if (!SLUG.test(slug)) throw fail(400, `„${slug}“ nie je slug`);
  if (!(WRITE_HEADER in req.headers)) throw fail(403, "Chýba admin hlavička");

  if (part === "image" && req.method === "PUT") {
    const note = await savePhoto(slug, await readBody(req, 60 * MEGABYTE));
    return sendJson(res, 200, { image: "image.webp", note });
  }

  if (part !== undefined) throw fail(404, "Not found");

  if (req.method === "PUT") {
    const body = parseJson(await readBody(req, 80 * MEGABYTE));
    await saveTrail(slug, body);
    console.log(`${body.create ? "pridaná" : "uložená"} ${slug}`);
    return sendJson(res, 200, { slug });
  }

  if (req.method === "DELETE") {
    await deleteTrail(slug);
    console.log(`zmazaná ${slug}`);
    return sendJson(res, 200, { slug });
  }

  throw fail(405, "Method not allowed");
}

/**
 * The Strava endpoints: the two pages the author's consent goes through, and
 * what the editor asks for itself. See tools/strava.mjs.
 * @param {*} req
 * @param {*} res
 * @param {string[]} parts the path after /api/strava/
 */
async function strava(req, res, [action, id, ...rest]) {
  if (rest.length) throw fail(404, "Not found");

  const page = action === "connect" || action === "callback";

  // The author is sent through these two, so they answer with pages
  if (page && id === undefined && req.method === "GET") {
    try {
      if (action === "connect") {
        res.writeHead(302, {
          Location: await authorizeUrl(callbackUrl(req)),
          "Cache-Control": "no-store",
        });
        return res.end();
      }

      await finishConnect(new URL(req.url, "http://localhost").searchParams);
      console.log("Strava pripojená");

      return sendPage(res, 200, {
        title: "Strava je pripojená",
        text: "Toto okno môžeš zavrieť a vrátiť sa do editora.",
        done: true,
      });
    } catch (err) {
      if (!err.status) console.error(err);

      return sendPage(res, err.status ?? 500, {
        title: "Stravu sa nepodarilo pripojiť",
        text: err.status ? err.message : "Niečo sa pokazilo, viac je v konzole servera.",
      });
    }
  }

  if (!(WRITE_HEADER in req.headers)) throw fail(403, "Chýba admin hlavička");

  if (action === "credentials" && id === undefined && req.method === "PUT") {
    await saveCredentials(parseJson(await readBody(req, MEGABYTE)));
    return sendJson(res, 200, {});
  }

  if (action === "activities" && id && req.method === "GET") {
    const track = await activityTrack(id);
    console.log(`zo Stravy aktivita ${id}, ${track.coords.length} bodov`);
    return sendJson(res, 200, track);
  }

  throw fail(404, "Not found");
}

/**
 * Where Strava sends the author back to: this server, under the name the
 * editor was opened with, so the page that comes up can tell the editor.
 * @param {*} req
 * @returns {string}
 */
function callbackUrl(req) {
  // Strava lets localhost and 127.0.0.1 through as they are, [::1] it does not
  const host = req.headers.host.replace(/^\[::1\]/, "localhost");

  return `http://${host}/api/strava/callback`;
}

/**
 * Writes a trail: its feature into trails.geojson, and its gpx when one came
 * along. The gpx goes first, so a feature never points at a missing file.
 * @param {string} slug
 * @param {*} body
 * @param {*} body.feature the whole feature, as it should stand in the file
 * @param {string} [body.gpx] content of data/trails/<slug>.gpx
 * @param {boolean} [body.create] refuse to overwrite a trail that exists
 */
async function saveTrail(slug, { feature, gpx, create }) {
  const clean = checkedFeature(feature, slug);

  const collection = await readTrails();
  const at = collection.features.findIndex((f) => f.properties?.slug === slug);

  if (create && at !== -1) throw fail(409, `Trasa „${slug}“ už existuje`);
  if (!create && at === -1) throw fail(404, `Trasa „${slug}“ neexistuje`);
  if (create && typeof gpx !== "string") throw fail(400, "Novej trase chýba GPX");

  if (typeof gpx === "string") await writeFile(gpxPath(slug), gpx);

  if (at === -1) collection.features.push(clean);
  else collection.features[at] = clean;

  await writeTrails(collection);
}

/**
 * Takes a trail out of trails.geojson, together with its gpx and its photos.
 * @param {string} slug
 */
async function deleteTrail(slug) {
  const collection = await readTrails();
  const kept = collection.features.filter((f) => f.properties?.slug !== slug);

  if (kept.length === collection.features.length) {
    throw fail(404, `Trasa „${slug}“ neexistuje`);
  }

  await writeTrails({ ...collection, features: kept });
  await rm(gpxPath(slug), { force: true });
  await rm(imageFolder(slug), { recursive: true, force: true });
}

/**
 * Files an uploaded photo the way it is done by hand: through
 * tools/reduce-photo.sh, so the crop, the size and the quality have one
 * definition. The tool reads data/images/tmp.jpg and removes it when done.
 * @param {string} slug
 * @param {Buffer} bytes the photo as it was picked
 * @returns {Promise<string>} what the tool printed
 */
async function savePhoto(slug, bytes) {
  if (!bytes.length) throw fail(400, "Prázdna fotka");

  if (await exists(PHOTO_SOURCE)) {
    throw fail(
      409,
      "data/images/tmp.jpg už existuje. Spracuj ho alebo zmaž a skús znova.",
    );
  }

  await writeFile(PHOTO_SOURCE, bytes);

  try {
    const { stdout } = await run("/bin/zsh", [PHOTO_TOOL, slug], { cwd: ROOT });

    return stdout.trim();
  } catch (err) {
    console.error(`reduce-photo.sh ${slug}:`, (err.stderr || err.message).trim());

    // What the tool had started on: its half written file, and the folder
    // when this was to be the first photo in it
    await rm(join(imageFolder(slug), "image.tmp.webp"), { force: true });
    await rmdir(imageFolder(slug)).catch(() => {});

    throw fail(
      422,
      "Fotku sa nepodarilo spracovať. Má to byť JPEG, PNG alebo WebP.",
    );
  } finally {
    // The tool removes its source only when it succeeds
    await rm(PHOTO_SOURCE, { force: true });
  }
}

/**
 * Checks a feature before it is let into the file and rebuilds it with
 * nothing but the three keys a feature has.
 * @param {*} feature
 * @param {string} slug the slug from the url, which it has to carry
 * @returns {*} the feature to store
 */
function checkedFeature(feature, slug) {
  const { properties, geometry } = feature ?? {};

  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    throw fail(400, "Trase chýbajú properties");
  }

  if (properties.slug !== slug) throw fail(400, "Slug v trase nesedí s adresou");
  if (!String(properties.name ?? "").trim()) throw fail(400, "Trase chýba názov");

  const coordinates = geometry?.coordinates;
  const line =
    geometry?.type === "LineString" &&
    Array.isArray(coordinates) &&
    coordinates.length >= 2 &&
    coordinates.every(
      (point) =>
        Array.isArray(point) && point.length >= 2 && point.every(Number.isFinite),
    );

  if (!line) throw fail(400, "Trase chýba línia");

  return {
    type: "Feature",
    properties,
    geometry: { type: "LineString", coordinates },
  };
}

async function readTrails() {
  const collection = JSON.parse(await readFile(TRAILS, "utf8"));

  if (!Array.isArray(collection.features)) {
    throw fail(500, "data/trails.geojson nemá features");
  }

  return collection;
}

/**
 * Writes trails.geojson through a temporary file, so a crash midway leaves
 * the old one in place rather than half of the new one.
 * @param {*} collection
 */
async function writeTrails(collection) {
  const temporary = `${TRAILS}.tmp`;

  await writeFile(temporary, `${print(collection, "", 0, 0)}\n`);
  await rename(temporary, TRAILS);
}

/**
 * Prints json the way Prettier leaves trails.geojson when it is saved from
 * the editor, so a save from the admin shows up in git as the lines that
 * changed and nothing else. Objects are always spread out; an array stays on
 * one line while it fits, and a list of coordinates never does.
 * @param {*} value
 * @param {string} indent indentation of the line the value starts on
 * @param {number} lead columns already taken on that line
 * @param {number} trail columns the line still needs after the value
 * @returns {string}
 */
function print(value, indent, lead, trail) {
  if (Array.isArray(value)) {
    if (!value.length) return "[]";

    const flat = flatArray(value);

    if (
      flat !== null &&
      !alwaysBroken(value) &&
      lead + width(flat) + trail <= PRINT_WIDTH
    ) {
      return flat;
    }

    const inner = `${indent}  `;
    const rows = value.map(
      (entry, index) =>
        inner + print(entry, inner, inner.length, index < value.length - 1 ? 1 : 0),
    );

    return `[\n${rows.join(",\n")}\n${indent}]`;
  }

  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value);
    if (!keys.length) return "{}";

    const inner = `${indent}  `;
    const rows = keys.map((key, index) => {
      const head = `${JSON.stringify(key)}: `;
      const rest = index < keys.length - 1 ? 1 : 0;

      return (
        inner + head + print(value[key], inner, inner.length + width(head), rest)
      );
    });

    return `{\n${rows.join(",\n")}\n${indent}}`;
  }

  return JSON.stringify(value);
}

/**
 * An array on a single line, or null when something in it has to be spread.
 * @param {*[]} array
 * @returns {string|null}
 */
function flatArray(array) {
  const parts = [];

  for (const entry of array) {
    if (Array.isArray(entry)) {
      const nested = flatArray(entry);
      if (nested === null) return null;

      parts.push(nested);
    } else if (entry !== null && typeof entry === "object") {
      if (Object.keys(entry).length) return null;

      parts.push("{}");
    } else {
      parts.push(JSON.stringify(entry));
    }
  }

  return `[${parts.join(", ")}]`;
}

/**
 * Prettier breaks a list of lists however short it is, which is what keeps
 * every coordinate on a line of its own.
 * @param {*[]} array
 * @returns {boolean}
 */
function alwaysBroken(array) {
  return (
    array.length > 1 &&
    array.every((entry) => Array.isArray(entry) && entry.length > 1)
  );
}

/**
 * Columns a text takes. Combining accents sit on the letter before them.
 * @param {string} text
 * @returns {number}
 */
function width(text) {
  return [...text.replace(/\p{M}/gu, "")].length;
}

/**
 * The static half: any file under the project, except the hidden ones.
 * @param {*} req
 * @param {*} res
 * @param {string} path decoded pathname
 */
async function serveFile(req, res, path) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    throw fail(405, "Method not allowed");
  }

  // Covers .git and friends, and ".." along the way
  if (path.split("/").some((part) => part.startsWith("."))) {
    throw fail(404, "Not found");
  }

  const file = resolve(ROOT, `.${path.endsWith("/") ? `${path}index.html` : path}`);
  if (!file.startsWith(ROOT + sep)) throw fail(404, "Not found");

  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) throw fail(404, "Not found");

  res.writeHead(200, {
    "Content-Type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
    "Content-Length": info.size,
    // Data changes under the app all the time here, never serve it stale
    "Cache-Control": "no-store",
  });

  if (req.method === "HEAD") res.end();
  else createReadStream(file).pipe(res);
}

/**
 * Collects a request body.
 * @param {*} req
 * @param {number} limit bytes it may take
 * @returns {Promise<Buffer>}
 */
async function readBody(req, limit) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw fail(413, "Príliš veľký súbor");

    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

/**
 * A request body as json.
 * @param {Buffer} bytes
 * @returns {*}
 */
function parseJson(bytes) {
  try {
    return JSON.parse(bytes.toString("utf8")) ?? {};
  } catch {
    throw fail(400, "Telo požiadavky nie je JSON");
  }
}

function sendJson(res, status, body) {
  if (res.headersSent) return res.end();

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

/**
 * A page of a line or two, for the window the Strava consent happens in. It
 * wears the colours of the app, and when all went well it tells the editor
 * and closes itself.
 * @param {*} res
 * @param {number} status
 * @param {*} page
 * @param {string} page.title
 * @param {string} page.text
 * @param {boolean} [page.done] whether Strava is connected now
 */
function sendPage(res, status, { title, text, done = false }) {
  const announce = `<script>
  new BroadcastChannel("${STRAVA_CHANNEL}").postMessage("connected");
  window.close();
</script>`;

  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(`<!doctype html>
<html lang="sk">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · MultiTrail</title>
<style>
  body {
    display: grid;
    place-content: center;
    margin: 0;
    background-color: #f7f8f8;
    padding: 24px;
    min-height: 100vh;
    box-sizing: border-box;
    color: #292d3c;
    font: 16px/1.5 system-ui, sans-serif;
    text-align: center;
  }
  h1 { margin: 0 0 8px; color: ${done ? "#0f766e" : "inherit"}; font-size: 22px; font-weight: 500; }
  p { margin: 0; max-width: 34em; color: #5c6066; }
</style>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(text)}</p>
${done ? announce : ""}
</html>
`);
}

function escapeHtml(text) {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );
}

/**
 * Whether a Host header names this machine.
 * @param {string} [host]
 * @returns {boolean}
 */
function isLocalHost(host = "") {
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

async function exists(path) {
  return (await stat(path).catch(() => null)) !== null;
}

/**
 * An error that knows which http status it is.
 * @param {number} status
 * @param {string} message
 * @returns {Error}
 */
function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

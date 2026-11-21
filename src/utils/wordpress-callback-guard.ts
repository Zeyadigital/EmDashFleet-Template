// The WordPress authorization callback answers only a browser that asked for
// it (security audit of 2026-11-21, Template v13). EmDash's callback route
// takes a WordPress address, user name and application password from the query
// string of a GET, with no state, and stores them in a cookie the admin's
// WordPress import page reads on load to start an analysis of that address, so
// a link on another site could make a signed-in administrator's browser
// analyse a WordPress site and credential of the link author's choosing. The
// admin sends POST /_emdash/api/import/probe, which needs import:execute,
// before it sends the browser to WordPress; the Worker answers that probe with
// an HttpOnly cookie scoped to the callback, refuses a callback without it, and
// clears it once a callback is served. SameSite=Lax keeps the cookie on the
// top-level redirect back from WordPress.
// node_modules/emdash/src/astro/routes/api/import/wordpress-plugin/callback.ts
// node_modules/emdash/src/astro/routes/api/import/probe.ts
// node_modules/@emdash-cms/admin/dist/index.js (handlePluginConnect)

import { routedPath } from "./routed-path.ts";

const PROBE_PATH = "/_emdash/api/import/probe";
const CALLBACK_DIRECTORY = "/_emdash/api/import/wordpress-plugin/";
const CALLBACK_PATH = `${CALLBACK_DIRECTORY}callback`;
const REJECTED = "/_emdash/admin/import/wordpress?error=auth_rejected";

/** The cookie that marks an authorization the administrator started. */
export const AUTHORIZE_COOKIE = "fleet_wp_authorize";

/** How long, in seconds, an authorization started by a probe stays open. */
export const AUTHORIZE_SECONDS = 15 * 60;

function hasAuthorizeCookie(request: Request): boolean {
	const header = request.headers.get("cookie") ?? "";
	return header.split(";").some((part) => part.trim().startsWith(`${AUTHORIZE_COOKIE}=`));
}

function authorizeCookie(url: URL, maxAge: number): string {
	const secure = url.protocol === "https:" ? "; Secure" : "";
	return `${AUTHORIZE_COOKIE}=${maxAge > 0 ? "1" : ""}; Path=${CALLBACK_DIRECTORY}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

/** A redirect to the import page's rejection for a callback no probe opened, or null to serve the request. */
export function refuseWordPressCallback(request: Request): Response | null {
	if (routedPath(new URL(request.url).pathname) !== CALLBACK_PATH || hasAuthorizeCookie(request)) return null;
	return new Response(null, { status: 303, headers: { location: REJECTED, "cache-control": "no-store" } });
}

/** `response` with the authorization cookie set after an authorised probe and cleared after a callback. */
export function withWordPressAuthorizeCookie(request: Request, response: Response): Response {
	const url = new URL(request.url);
	const path = routedPath(url.pathname);
	let cookie: string | null = null;
	if (path === PROBE_PATH && request.method === "POST" && response.status !== 401 && response.status !== 403) {
		cookie = authorizeCookie(url, AUTHORIZE_SECONDS);
	} else if (path === CALLBACK_PATH) {
		cookie = authorizeCookie(url, 0);
	}
	if (cookie === null) return response;
	const marked = new Response(response.body, response);
	marked.headers.append("set-cookie", cookie);
	return marked;
}

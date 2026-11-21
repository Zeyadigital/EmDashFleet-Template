// Refuses an EmDash route whose path carries an encoded backslash (security
// audit of 2026-11-21, Template h30). Astro routes on the decoded path, where
// %5C stays a backslash inside one segment, while EmDash's middleware reads
// the normalized URL, where it becomes a slash and ".." segments resolve, so
// a slug such as "..%5C..%5Cauth%5Cx" lets the write fences and the token
// scope check classify the request as another route. A literal backslash and
// encoded dot segments are normalized by the URL parser before the Worker
// sees request.url, so %5C is the one form left; no EmDash route names a
// backslash.
// https://url.spec.whatwg.org/#path-state
//
// A path longer than MAX_PATH_LENGTH is answered 414 (security audit of
// 2026-11-21, Template v11). EmDash stores the path of every 404 in its
// _emdash_404_log table without a length limit, one row per distinct path,
// and its hourly cleanup trims the table back to 10,000 rows only afterwards,
// so an anonymous visitor could store rows of up to Cloudflare's 16 KB URL
// length in the site's D1 database. The cap is the one emdashfleet.com uses
// (EmDashFleet-Page, src/utils/path-limit.ts); no route EmDash defines comes
// near it, and a page whose path is longer cannot be served.
// node_modules/emdash/src/database/repositories/redirect.ts (log404, MAX_404_LOG_ROWS)
// https://developers.cloudflare.com/workers/platform/limits/#request-limits

/** The longest pathname, in characters of its percent-encoded form, that is served. */
export const MAX_PATH_LENGTH = 1024;

const EMDASH_PREFIX = "/_emdash/";
const ENCODED_BACKSLASH = /%5c/i;

const refusal = (status: number, text: string) =>
	new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/** A 414 answer for a path longer than MAX_PATH_LENGTH, a 400 answer for an EmDash route whose path carries %5C, or null to serve the request. */
export function refusePath(request: Request): Response | null {
	const { pathname } = new URL(request.url);
	if (pathname.length > MAX_PATH_LENGTH) return refusal(414, "URI Too Long");
	if (!pathname.startsWith(EMDASH_PREFIX) || !ENCODED_BACKSLASH.test(pathname)) return null;
	return refusal(400, "Bad Request");
}

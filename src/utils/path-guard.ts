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

const EMDASH_PREFIX = "/_emdash/";
const ENCODED_BACKSLASH = /%5c/i;

/** A 400 answer for an EmDash route whose path carries %5C, or null to serve the request. */
export function refuseEncodedBackslash(request: Request): Response | null {
	const { pathname } = new URL(request.url);
	if (!pathname.startsWith(EMDASH_PREFIX) || !ENCODED_BACKSLASH.test(pathname)) return null;
	return new Response("Bad Request", { status: 400, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

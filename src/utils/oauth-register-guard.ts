// The anonymous OAuth client registration is capped in size (security audit of
// 2026-11-21, Template S2). POST /_emdash/api/oauth/register is public by
// design, because MCP clients, the emdash CLI and Fleet's site admin
// connection (app plan D21) register there before anyone signs in, and EmDash
// 1.5.0 stores the client name, every redirect URI and the scope it is sent
// without a length limit, one row per call, so one request of several
// megabytes stores one row of that size in the site's D1 database. The Worker
// refuses a body over 4,096 bytes, read as a stream so a chunked body is not
// buffered whole, a client name over 200 characters, more than 5 redirect URIs,
// a redirect URI over 2,048 characters and a scope over 512 characters, and
// passes every other request on untouched. Who may register is not restricted:
// Fleet's registration (one redirect URI, the client name "EmDash Fleet" and
// the scope "admin", under 300 bytes) and every standards-compliant client
// stay far below each cap. The number of rows stays EmDash's.
// node_modules/emdash/src/astro/routes/api/oauth/register.ts
// node_modules/emdash/src/api/handlers/oauth-clients.ts (handleOAuthClientCreate)
// https://www.rfc-editor.org/rfc/rfc7591#section-3.2.2

import { routedPath } from "./routed-path.ts";

const REGISTER_PATH = "/_emdash/api/oauth/register";

/** The most bytes the body of a registration may hold. */
export const MAX_BODY_BYTES = 4096;
/** The most characters of `client_name`. */
export const MAX_CLIENT_NAME = 200;
/** The most entries of `redirect_uris`. */
export const MAX_REDIRECT_URIS = 5;
/** The most characters of one entry of `redirect_uris`. */
export const MAX_REDIRECT_URI = 2048;
/** The most characters of `scope`, an array of scopes counted as one space-separated string. */
export const MAX_SCOPE = 512;

// The headers of EmDash's own registration answers: an RFC 7591 error body,
// uncached, readable by the browser-based MCP clients that call cross-origin.
const HEADERS = { "cache-control": "no-store", pragma: "no-cache", "access-control-allow-origin": "*" };

const refusal = (status: number, description: string) =>
	Response.json({ error: "invalid_client_metadata", error_description: description }, { status, headers: HEADERS });

const tooLarge = () => refusal(413, `Request body must not exceed ${MAX_BODY_BYTES} bytes`);

/** The first MAX_BODY_BYTES + 1 bytes at most of `body`, or null once it holds more than MAX_BODY_BYTES; reading stops there. */
async function readCapped(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array | null> {
	if (body === null) return new Uint8Array(0);
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > MAX_BODY_BYTES) {
			// Not awaited: the cancel of one branch of a cloned body settles only
			// when the other branch, the original request's, is cancelled too.
			reader.cancel().catch(() => undefined);
			return null;
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

function scopeLength(scope: unknown): number {
	if (typeof scope === "string") return scope.length;
	if (Array.isArray(scope)) return scope.filter((item) => typeof item === "string").join(" ").length;
	return 0;
}

/** The refusal for the field of a registration that is over its cap, or null. */
function fieldRefusal(body: Record<string, unknown>): Response | null {
	const { client_name: name, redirect_uris: uris, scope } = body;
	if (typeof name === "string" && name.length > MAX_CLIENT_NAME) return refusal(400, `client_name must not exceed ${MAX_CLIENT_NAME} characters`);
	if (Array.isArray(uris)) {
		if (uris.length > MAX_REDIRECT_URIS) return refusal(400, `redirect_uris must not hold more than ${MAX_REDIRECT_URIS} entries`);
		if (uris.some((uri) => typeof uri === "string" && uri.length > MAX_REDIRECT_URI)) {
			return refusal(400, `a redirect URI must not exceed ${MAX_REDIRECT_URI} characters`);
		}
	}
	if (scopeLength(scope) > MAX_SCOPE) return refusal(400, `scope must not exceed ${MAX_SCOPE} characters`);
	return null;
}

/** A 413 or 400 answer for an oversized client registration, or null to serve the untouched request. */
export async function refuseOversizedRegistration(request: Request): Promise<Response | null> {
	if (request.method !== "POST" || routedPath(new URL(request.url).pathname) !== REGISTER_PATH) return null;
	const declared = request.headers.get("content-length");
	if (declared !== null && Number(declared) > MAX_BODY_BYTES) return tooLarge();
	let bytes: Uint8Array | null;
	try {
		// The clone is read; the original body stays unread for EmDash.
		bytes = await readCapped(request.clone().body);
	} catch {
		return null;
	}
	if (bytes === null) return tooLarge();
	let body: unknown;
	try {
		body = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return null;
	}
	if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
	return fieldRefusal(body as Record<string, unknown>);
}

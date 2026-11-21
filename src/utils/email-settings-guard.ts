// The site's email delivery is changed only from a signed-in browser (security
// audit of 2026-11-21, Template v16). EmDash 1.5.0 lets a bearer token whose
// scope is only settings:manage write PUT /_emdash/api/settings/email, which
// stores any SMTP host and makes it the exclusive email:deliver provider, while
// the provider selector and backups need the admin scope. Login links go out
// through that provider, so a token an Admin issued for settings, or approved
// for a third-party OAuth client, could send the next magic link of any user to
// a host of the token holder's choosing. The admin saves these settings with
// its session cookie, and neither Fleet nor EmDash's MCP tools write them with
// a token, so the Worker refuses a request to that route that carries an
// Authorization header and is not a GET or HEAD.
// node_modules/emdash/src/astro/routes/api/settings/email.ts
// node_modules/emdash/src/astro/middleware/auth.ts (SCOPE_RULES, handleBearerAuth)

import { routedPath } from "./routed-path.ts";

const EMAIL_SETTINGS_PATH = "/_emdash/api/settings/email";

/** A 403 for a token-authorised write to the email settings, or null to serve the request. */
export function refuseTokenEmailSettings(request: Request): Response | null {
	if (request.method === "GET" || request.method === "HEAD" || !request.headers.has("authorization")) return null;
	if (routedPath(new URL(request.url).pathname) !== EMAIL_SETTINGS_PATH) return null;
	return Response.json(
		{ error: { code: "FORBIDDEN", message: "Email settings can be changed only from the admin, signed in." } },
		{ status: 403, headers: { "cache-control": "no-store" } },
	);
}

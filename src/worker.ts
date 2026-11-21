import handler, { createScheduledHandler, PluginBridge } from "@emdash-cms/cloudflare/worker";
import { refusePath } from "./utils/path-guard";
import { refuseWordPressCallback, withWordPressAuthorizeCookie } from "./utils/wordpress-callback-guard";

export { PluginBridge };

export default {
	...handler,
	// A path over 1,024 characters, and an EmDash route whose path carries %5C,
	// never reach EmDash (utils/path-guard.ts), nor a WordPress authorization
	// callback the administrator did not start (utils/wordpress-callback-guard.ts).
	fetch: async (request, env, ctx) =>
		refusePath(request) ??
		refuseWordPressCallback(request) ??
		withWordPressAuthorizeCookie(request, await handler.fetch!(request, env, ctx)),
	scheduled: createScheduledHandler(),
} satisfies ExportedHandler;

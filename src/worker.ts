import handler, { createScheduledHandler, PluginBridge } from "@emdash-cms/cloudflare/worker";
import { refusePath } from "./utils/path-guard";

export { PluginBridge };

export default {
	...handler,
	// A path over 1,024 characters, and an EmDash route whose path carries %5C,
	// never reach EmDash (utils/path-guard.ts).
	fetch: (request, env, ctx) => refusePath(request) ?? handler.fetch!(request, env, ctx),
	scheduled: createScheduledHandler(),
} satisfies ExportedHandler;

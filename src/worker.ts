import handler, { createScheduledHandler, PluginBridge } from "@emdash-cms/cloudflare/worker";
import { refuseEncodedBackslash } from "./utils/path-guard";

export { PluginBridge };

export default {
	...handler,
	// An EmDash route whose path carries %5C never reaches EmDash (utils/path-guard.ts).
	fetch: (request, env, ctx) => refuseEncodedBackslash(request) ?? handler.fetch!(request, env, ctx),
	scheduled: createScheduledHandler(),
} satisfies ExportedHandler;

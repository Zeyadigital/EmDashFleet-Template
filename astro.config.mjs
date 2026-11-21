// The Astro configuration of an EmDash site created by EmDash Fleet, taken from
// EmDash's blog-cloudflare template at emdash@1.4.0. Fleet's first commit to a
// new site repository replaces the placeholder `site` with the site's URL. No
// `sandboxRunner` is set, so sandboxed plugins stay disabled.
// https://docs.emdashcms.com/reference/configuration/
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { d1, r2 } from "@emdash-cms/cloudflare";
import { defineConfig, fontProviders } from "astro/config";
import emdash from "emdash/astro";

export default defineConfig({
	site: "https://fleet-placeholder.invalid",
	output: "server",
	adapter: cloudflare(),
	image: {
		layout: "constrained",
		responsiveStyles: true,
	},
	integrations: [
		react(),
		emdash({
			// "primary-first" starts every request's D1 session with
			// withSession("first-primary"), so an anonymous or bearer read never
			// begins on a read replica that may not yet hold a revoked token or a
			// disabled user (security audit of 2026-11-21, Template record 0).
			// Browser sessions keep their bookmark.
			// https://developers.cloudflare.com/d1/best-practices/read-replication/
			database: d1({ binding: "DB", session: "primary-first", coalesce: true }),
			storage: r2({ binding: "MEDIA" }),
			// No blurhash or dominant colour is derived from uploaded images
			// (security audit of 2026-11-21, Template v14): EmDash 1.5.0 bounds the
			// decode by the first PNG header only, so a small upload that inflates
			// to hundreds of megabytes passes and can exhaust the Worker's 128 MB.
			// Dimensions, validation and content hashing stay on.
			// node_modules/emdash/src/media/enrich.ts, src/media/placeholder.ts
			imagePlaceholders: false,
		}),
	],
	fonts: [
		{
			provider: fontProviders.google(),
			name: "Inter",
			cssVariable: "--font-body",
			weights: [400, 500, 600, 700],
			fallbacks: ["sans-serif"],
		},
		{
			provider: fontProviders.google(),
			name: "JetBrains Mono",
			cssVariable: "--font-mono",
			weights: [400, 500],
			fallbacks: ["monospace"],
		},
	],
	devToolbar: { enabled: false },
});

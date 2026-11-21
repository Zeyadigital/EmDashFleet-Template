/**
 * The Cache-Control of the RSS feed for `request`. A request that carries a
 * cookie may come from a signed-in editor in EmDash's edit mode, whose
 * collection reads serve draft revisions, and EmDash marks only HTML pages
 * that received its toolbar as private; such a feed is never stored by a
 * shared cache. Feed readers send no cookies and keep the hour of public
 * caching (security audit of 2026-11-21, Template h31).
 */
export function feedCacheControl(request: Request): string {
	return request.headers.has("cookie") ? "private, no-store" : "public, max-age=3600";
}

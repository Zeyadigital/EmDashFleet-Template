// The path as EmDash's routing reads it, for guards that must match every
// spelling of a route: percent-decoded, lower case, single slashes and no
// trailing slash. An undecodable path is compared as it came.

export function routedPath(pathname: string): string {
	let path = pathname;
	try {
		path = decodeURI(pathname);
	} catch {
		// Compared as it came.
	}
	return path.toLowerCase().replace(/\/{2,}/g, "/").replace(/\/+$/, "");
}

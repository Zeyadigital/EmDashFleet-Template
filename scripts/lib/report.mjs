// The output format of the template checks under scripts/, the same as the
// checks of Zeyadigital/EmDashFleet-App: one line per finding,
// `<file>[:<line>] [<rule>] <message>`, then FAIL or PASS.

/**
 * @typedef {object} Finding
 * @property {string} file
 * @property {number} [line]
 * @property {string} rule
 * @property {string} message
 */

/**
 * Prints the findings of one check and sets a failing exit code when there is any.
 * @param {string} check
 * @param {readonly Finding[]} findings
 */
export function report(check, findings) {
	for (const finding of findings) {
		const where = finding.line === undefined ? finding.file : `${finding.file}:${finding.line}`;
		console.error(`${where} [${finding.rule}] ${finding.message}`);
	}
	if (findings.length > 0) {
		console.error(`${check}: FAIL (${findings.length})`);
		process.exitCode = 1;
	} else {
		console.log(`${check}: PASS`);
	}
}

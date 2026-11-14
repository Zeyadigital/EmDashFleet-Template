# EmDash site

An [EmDash](https://github.com/emdash-cms/emdash) site for Cloudflare Workers, created from the EmDash Fleet site template. [EmDash Fleet](https://emdashfleet.com) builds this repository, deploys it to the Cloudflare account it was connected with and installs EmDash and plugin updates when someone asks for them in Fleet. It is an ordinary Astro and EmDash project: the site keeps running without Fleet, and you can build and deploy it yourself.

## Workers Free and sandboxed plugins

The site runs on Workers Free and on Workers Paid. `wrangler.jsonc` declares no `worker_loaders` binding, so EmDash's sandboxed plugins are disabled: EmDash's Cloudflare plugin sandbox needs Workers Paid and a `worker_loaders` binding named `LOADER`, and without it sandboxed plugins do not load ([Installing plugins](https://docs.emdashcms.com/plugins/installing/), [Plugin sandbox](https://docs.emdashcms.com/deployment/plugin-sandbox/)).

## How EmDash Fleet builds and updates the site

The two workflows in `.github/workflows/` run only when someone starts a deployment or an update in Fleet. Neither runs on a push, a pull request or a schedule, and Fleet never sets up Cloudflare builds, so pushing to this repository deploys nothing.

- `fleet-build.yml` checks out the commit Fleet names, runs `npm ci`, checks the npm registry signatures of the installed packages (`scripts/audit-signatures.mjs`), runs `npm run build` and bundles the Worker with `npx wrangler versions upload --dry-run`, which uploads nothing. It keeps the bundle and the static files as a workflow artifact for one day; Fleet downloads it and uploads the new version to Cloudflare itself.
- `fleet-update.yml` installs the exact EmDash or plugin version Fleet names on the latest commit of the default branch and keeps the changed files as a workflow artifact for one day. Fleet checks them and commits them to this repository; the workflow writes nothing.

Both workflows only read the repository and hold no secret and no Cloudflare credential. Fleet builds this site with GitHub Actions in the repository, within the repository owner's GitHub Actions allowance (USD 12 of usage a month included on GitHub Free) and 500 MB of artifact storage; usage beyond that is charged by GitHub to the repository owner ([GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [included usage](https://docs.github.com/en/billing/reference/product-usage-included)).

Keep both workflow files, their names, triggers and inputs, and `scripts/audit-signatures.mjs` with `scripts/lib/report.mjs`, as they are. A changed workflow file still deploys, and Fleet shows a warning on the site.

## Creating the repository yourself

When an EmDash Fleet link asks you to create the repository first:

1. Open [the template](https://github.com/Zeyadigital/EmDashFleet-Template) and choose **Use this template** > **Create a new repository** ([GitHub's guide](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-repository-from-a-template)).
2. Choose the owner and the repository name the link names, and keep **Include all branches** off.
3. Go back to the link and, when GitHub asks which repositories the EmDash Fleet app may access, select only this repository.

Fleet keeps the placeholders of the next section in a repository you created yourself and commits only the updates someone asks for in Fleet.

## Values Fleet fills in

In a repository Fleet creates, its first commit, "Configure Fleet site", replaces the placeholders that start with `fleet-placeholder`:

| File | Placeholder | Replaced with |
| --- | --- | --- |
| `wrangler.jsonc` | `fleet-placeholder-d1-database-id` | the id of the site's D1 database (`DB`) |
| `wrangler.jsonc` | `fleet-placeholder-media` | the name of the site's R2 bucket (`MEDIA`) |
| `wrangler.jsonc` | `fleet-placeholder-kv-namespace-id` | the id of the site's KV namespace (`SESSION`) |
| `astro.config.mjs` | `https://fleet-placeholder.invalid` | the site's URL |

Fleet deploys every build with the bindings of its own records of the site, so these values are read only by local development, the build and your own deployments. Keep the binding names `DB`, `MEDIA`, `SESSION` and `IMAGES` as they are.

## Local development

Use the Node.js version of `.nvmrc` and npm 12.2.2.

```sh
npm ci
npm run dev
```

`npm run dev` serves the site with local bindings, so it never touches the Cloudflare account; open `/_emdash/admin` to set it up. To run the built Worker locally, run `npm run build` and then `npx wrangler dev --local`.

## Template-only files

These files serve the template's own maintenance, and you can delete them:

- `.github/workflows/template-checks.yml` runs only in the template repository itself: it starts on a push to `dev` or `main` and on a pull request into `dev`, and the job's condition names the template repository, so in a site repository the job is skipped.
- `.github/dependabot.yml` serves only the template repository: it turns on Dependabot version updates. Fleet never deletes a file from your repository, so it stays until you delete it.
- `.gitleaks.toml` serves the template's secret scanning in `template-checks.yml`.
- `fleet-site-bindings.json` and the other files in `scripts/` that the template checks use, among them `scripts/check-pins.mjs` and `scripts/check-workflows.mjs`.

## Maintaining the template

This section applies to `Zeyadigital/EmDashFleet-Template` only.

- A co-founder pushes alone (github_oauth_plan.md D22, HR-162). `dev` is the integration branch and `main` is the branch Fleet creates repositories from. There is no pull request, review, approver, signed commit, Verified badge or local hook: push to `dev` while working and to `main` when the change is ready. Do not force-push `main`.
- `template-checks.yml` runs on each push to `dev` and `main` and on Dependabot's pull requests into `dev`: a gitleaks scan, `npm ci`, the contract tests checklist, `npm run types:check`, the registry signatures, `npm test`, the build, the dry-run bundle, `npm run check:bindings`, `npm run check:workflows`, `npm run check:pins` and `npm run check:migrations`.
- Secret scanning: gitleaks 8.30.1 runs in `template-checks.yml` only, from its release archive checked against the SHA-256 in the file, over the commits of each push or pull request. Nothing is installed or configured in a clone.
- Dependencies: every version in `package.json`, `.nvmrc` and `engines` is exact (`npm run check:pins`), and an action is pinned to a commit SHA. Dependabot opens the weekly pull requests into `dev` for npm and GitHub Actions, and a co-founder merges them.
- `compatibility_date` in `wrangler.jsonc` is raised to the current date only once the nightly contract tests pass on it, and a change that raises it fails until the line `- [x] The nightly contract tests passed on this change` is in the message of one of the commits of the push.
- `worker-configuration.d.ts` is generated: run `npm run types` after any change to `wrangler.jsonc`; the template checks fail when it is out of date.
- `fleet-site-bindings.json` is the output of `npm run export:site-bindings` in `Zeyadigital/EmDashFleet-App`; copy it again whenever the App's site bindings change.
- `src/`, `seed/`, `tsconfig.json` and `emdash-env.d.ts` come unchanged from EmDash's `blog-cloudflare` template; `THIRD_PARTY_NOTICES.md` records the source and its licence.

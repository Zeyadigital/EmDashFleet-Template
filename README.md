# EmDashFleet-Template

The template repository EmDash Fleet generates every new site repository from. It is an EmDash site for Cloudflare Workers carrying two workflow files:

- `.github/workflows/fleet-build.yml` builds the site when Fleet dispatches it.
- `.github/workflows/fleet-update.yml` updates EmDash when Fleet dispatches it.

Neither workflow runs on push. Fleet uploads the built bundle to the site's Cloudflare account through the Workers API, and Cloudflare builds are never configured.

## Branches

- `dev` is the integration branch. Changes are squash-merged into it after the other co-founder approves them and are tested against staging.
- `main` is the branch Fleet generates repositories from. Changes reach it only through a release pull request from `dev`, merged with a merge commit.

Every commit on this repository is signed.

# Releasing

Releases are made by hand by the maintainer, jmozez. Nothing here runs automatically. Publishing needs the maintainer's npm security key.

1. Check that `main` is green in CI, including the `package` job, which installs the packed tarball and runs it, and that CodeQL has no open alerts.
2. Check that `version` in `package.json` is right, and that `CHANGELOG.md` lists every change under that version with today's date.
3. Run `npm ci && npm audit && npm run typecheck && npm run build && npm test && npm pack --dry-run`. Check the file list: `dist`, `hosts`, `action.yml`, `README.md`, `CHANGELOG.md` and `LICENSE`.
4. Check that `hosts/hosts.yaml` has been reviewed within the last month, and update its `version` if any rule changed.
5. Publish with `npm publish`. `prepublishOnly` runs the type check and tests again, and `publishConfig` makes the scoped package public. To add provenance later, publish from a GitHub workflow with `npm publish --provenance`.
6. Tag the commit `vX.Y.Z`, push the tag, and create a GitHub release with the changelog section as its notes.
7. Move the `v0` tag to the new release so `jmozez/mcpmedic@v0` in workflows picks it up.

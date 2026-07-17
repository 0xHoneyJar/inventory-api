# Vendored `@freeside/collection-protocol` (CR-105 temporary seam)

This directory holds a **packaged artifact produced exactly from the CR-001
package** via `pnpm pack`. Inventory must not fork or hand-copy the protocol
schemas — CR-105's enrichment boundary decodes through this package's own
strict decoders and canonical digest encoder.

## Artifact

- File: `freeside-collection-protocol-1.0.0.tgz`
- Package: `@freeside/collection-protocol@1.0.0`
- SHA-256: `b0d0666867988bc67094d9189048f7bca0b89ea1140a7705d6953528f7d5298c` (also in `SHA256SUMS`)
- Source worktree: `../cr-001/packages/protocol/collection` (coordinator layout)
- Source commit (at pack time): `a688e516e886d29a6aaa1c90fa76c80c0a84d8c1`
- Copied byte-identically from the CR-003 vendor seam
  (`../cr-003/vendor/collection-protocol`, packed `2026-07-16T09:58:14Z`);
  checksum verified equal to CR-003's `SHA256SUMS` at copy time, and the
  tarball's `dist/` + `fixtures/` verified byte-identical to the CR-001
  worktree at commit `a688e516`.

## Consumption

`package.json` points at the tarball
(`file:vendor/collection-protocol/freeside-collection-protocol-1.0.0.tgz`).
`effect` is the package's **peer dependency** and is declared by this repo
directly. Install with `bun install`.

Verify checksum before install:

```bash
cd vendor/collection-protocol && shasum -a 256 -c SHA256SUMS
```

## Refresh

From this worktree (with sibling CR-001 checked out only for refresh):

```bash
CR001_PKG=../cr-001/packages/protocol/collection
VENDOR=$PWD/vendor/collection-protocol
(cd "$CR001_PKG" && pnpm exec tsc -b && pnpm pack --pack-destination "$VENDOR")
cd "$VENDOR"
shasum -a 256 *.tgz | tee SHA256SUMS
# Update this PROVENANCE.md commit SHA and package.json if the tarball name changed
```

## Replacement (CR-005)

CR-005 publishes `@freeside/collection-protocol` and replaces this vendored
tarball with the ratified registry/semver pin. Do not treat this vendor path
as the long-term production seam.

# Upstream callback/timer fixture

Unmodified published ESM implementation of **throttle-debounce 5.0.2**, MIT
licensed. Both upstream copyright notices are retained in `LICENSE.md`.

- Repository: https://github.com/niksy/throttle-debounce
- Release: https://registry.npmjs.org/throttle-debounce/5.0.2
- Tarball: https://registry.npmjs.org/throttle-debounce/-/throttle-debounce-5.0.2.tgz
- Tarball integrity: `sha512-B71/4oyj61iNH0KeCamLuE2rmKuTO5byTOSVwECM5FA7TiAiAW+UqTKZ9ERueC4qvgSttUhdmq1mXC3kJqGX7A==`
- Published ESM entry: `esm/index.js` (7,121 bytes).
- Source SHA-256: `bf8f81da567b6a542d112b46e521d4295e68d97531343a55bfdec8e728fa5340`.
- License SHA-256: `b07649c798231a321f90abbb329c15e41a8b5ec5e814dde3e60cd4a470e3b012`.

The files were extracted from the official tarball after verifying its SHA-512
integrity. Tests verify their hashes and run offline. The source map directive is
retained unchanged; the map is not needed to execute this fixture.

This is a reproducible compatibility fixture, not a production dependency or a
fork. It tests retained callbacks, a package-private timer/cancellation closure,
async application writes and explicit component cleanup. No package-specific
compiler facts are supplied.

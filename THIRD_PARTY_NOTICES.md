# Third-party notices / Composants tiers

Agent World original contributions are distributed under MIT, Copyright © 2026 Manuel Andreolle. Third-party components retain their own copyright and license terms; they are not relicensed as Agent World.

## Notices included with this distribution

The complete notice bundle contains 277 entries covering locked JavaScript runtime dependencies, bundler helpers, and Rust normal/build dependencies for the universal macOS app and the Linux x86_64/ARM64 musl collectors. It also preserves the bundled SQLite amalgamation's public-domain header.

- Source checkout: `docs/third-party/THIRD-PARTY-LICENSES.txt` and `docs/third-party/manifest.json`.
- Mac app: right-click **Agent World.app → Show Package Contents**, then `Contents/Resources/licenses/THIRD-PARTY-LICENSES.txt`. The manifest and this index are in the same folder. No network access is needed to read them.
- Source collector archive: the same `docs/third-party/` folder accompanies the sources. Include the notices when redistributing a compiled collector.

The broader inventory in `docs/dependency-licenses.json` also lists development-only and unsupported-platform dependencies, not all of which ship in the app. Versions and notices must be rechecked whenever dependencies or release targets change.

## MPL 2.0 source availability

Unmodified MPL-covered sources for **cssparser 0.36.0, cssparser-macros 0.6.1, dtoa-short 0.3.5, option-ext 0.2.0 and selectors 0.36.1** accompany this distribution under their original MPL 2.0 terms. The full license text is in the notice bundle. Each original `.crate` archive matches its checksum in Cargo.lock and retains its authors' source notices.

- In the repository: `docs/third-party/mpl/`.
- Inside the Mac app: `Contents/Resources/licenses/mpl/`.
- Online source mirror: https://github.com/AndreolleManuel/agent-world/tree/main/docs/third-party/mpl

`.crate` files are gzip-compressed tar archives; extract them with `tar -xzf NAME.crate` in a dedicated directory. They contain the exact original source, not just a link to an upstream development branch. No MPL source modifications are made by this project.

Some published dependencies omit their license file. Cached supplements record the exact upstream commit and source URL. For selectors, whose upstream archive omits the full MPL text, the standard MPL 2.0 text is supplied alongside its complete original sources and copyright headers. This is documented in the manifest, not presented as an upstream file that does not exist.

## Maintainer checks

`npm run build:notices` rebuilds the bundle using installed locked npm dependencies, Cargo metadata in the local cache, and committed upstream supplements. `--fetch` explicitly permits retrieving missing supplements from commit-pinned upstream URLs. `node scripts/verify-notices.mjs` checks the reviewed bundle and source archive hashes without a network connection.

These are redistribution preparation records, not an independent legal certification. Project visuals and their maintainer attestation are recorded separately in `docs/asset-rights.json`; dependency notices do not establish rights over unrelated artwork or trademarks.

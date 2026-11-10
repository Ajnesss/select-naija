# Changelog

Versions follow semantic versioning. Each release passes `npm test` and `node scripts/report.js --gate`.

## 0.1.0 (unreleased)

- Addon server with no dependencies: manifest, catalogue rows by language with filters and paging,
  accent-insensitive search, detail pages for Select Naija IDs, streams for IMDb and Select Naija IDs.
- Three resolver layers: TMDB/JustWatch UK offers, provider index, verified direct files.
- Verifier with link states, provider "unavailable" detection, redirect resolution, provider scoring.
- Coverage report, release gate, nightly verification and test workflows.
- Setup script for a dedicated Oracle Micro server.
- Seed data: two documentaries and one diagnostic test title. The catalogue grows from v0.2.
- Release gate for 0.1.0: links and in-app playback confirmed on the Fire TV through the
  Select Naija AIOStreams config.

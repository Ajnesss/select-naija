# Changelog

Versions follow semantic versioning. Each release passes `npm test` and `node scripts/report.js --gate`.

## 0.2.0 (2026-11-11)

- Nightly discovery of Nigerian films and series watchable in the UK (TMDB, UK data from JustWatch):
  224 titles on the first run (Prime Video, Netflix, Tubi, Plex, Filmzie, MUBI, BBC iPlayer and more).
- Seed list for titles TMDB's country and language filters miss.
- New providers: Prime Video, Filmzie, and a catch-all for other UK services (named by TMDB).
- Netflix, Prime Video and Tubi links open that service's search for the title.

## 0.1.1 (2026-11-11)

- Fully hands-off checking: the nightly run now checks provider links too, using JustWatch's UK data
  (via TMDB) to catch titles that aren't available in the UK. No computer needs to be on.
- The UK check from Fortune's PC is now an optional extra; a UK result from the last 7 days wins.
- Links whose UK availability can't be confirmed are labelled in Nuvio and ranked after confirmed ones.

## 0.1.0 (2026-11-11)

- Provider pages only count as verified when checked from a UK connection (first GitHub run passed
  Tubi from the US while the UK showed "Content unavailable"). UK check point: `scripts/verify-uk.ps1`.
- Addon server with no dependencies: manifest, catalogue rows by language with filters and paging,
  accent-insensitive search, detail pages for Select Naija IDs, streams for IMDb and Select Naija IDs.
- Three resolver layers: TMDB/JustWatch UK offers, provider index, verified direct files.
- Verifier with link states, provider "unavailable" detection, redirect resolution, provider scoring.
- Coverage report, release gate, nightly verification and test workflows.
- Setup script for a dedicated Oracle Micro server.
- Seed data: two documentaries and one diagnostic test title. The catalogue grows from v0.2.
- Release gate for 0.1.0 passed 2026-11-11: custom-ID title, its detail page and in-app playback
  confirmed on the Fire TV through the Select Naija AIOStreams config. External links confirmed in
  Nuvio (iPhone, 2026-11-10) through the same config.
- Hosted on its own Oracle E2.1.Micro server (Frankfurt, AD 2), network select-naija-vcn,
  address select-naija.92-5-24-2.sslip.io. Nothing shared with Select DE.

# Changelog

## 0.4.0 (14 Nov 2026)

- Catalogue clean-up: removed three wrongly matched YouTube channels (a meditation channel, a Congolese channel and an actress's vlog); livestreams, talk shows, masterclasses, recaps and clips under 30 minutes no longer appear as films.
- Better names: clickbait ("Don't leave YouTube without watching…"), cast lists, bracketed names and channel labels are stripped from titles.
- Films uploaded in parts are one title (e.g. "Amare", parts 1–2); Hausa "Zango/Kashi" numbering and French "Saison/Épisode" are read as seasons and episodes; split shows ("Aiyetoro" / "Aiyetoro Town") are merged.
- AREWA24's Hausa drama series are now series with episodes.
- Rows open on the newest titles; genres and story descriptions are filled in; credits and "subscribe" text removed.
- Streams show HD/SD (once YouTube reports it), running time, part and channel.
- Settings page (/configure): choose languages and extra rows; the choice is carried in the install link.
- Empty rows and the diagnostics row are hidden; daily end-to-end check of the live addon.

Versions follow semantic versioning. Each release passes `npm test` and `node scripts/report.js --gate`.

## 0.3.0 (2026-11-12)

- In-app only by default: a stream is shown only if it plays inside Nuvio's own player. External links
  (browser, Netflix/Tubi/Plex apps, Dailymotion pages) are no longer shown, and titles without an in-app
  stream leave the rows. Coverage reports count in-app streams only. `SELECT_NAIJA_IN_APP_ONLY=0` restores links.
- Owner-authorised Dailymotion playback: when a channel owner supplies a Partner API key with the "Generate
  Stream URLs" permission, their films play in Nuvio from permanent stream addresses Dailymotion issues for
  the owner (no IP lock, no expiry). Ready for Extra Nolly TV and YORUBAWOOD; inactive until they agree.
- Research: source register with in-app playability and authorisation checks (`research/SOURCES.md`),
  research probes and a playback test that can run through the London check point.

## 0.2.1 (2026-11-11)

- Free only by default: subscription and rental links are hidden, so every title shown can be watched
  without a paid service (Tubi, Plex, Prime Video's free section, BBC iPlayer, Channel 4, Filmzie).
  `SELECT_NAIJA_FREE_ONLY=0` shows paid services again.
- Netflix links open the film itself (Netflix IDs from Wikidata) instead of a search.

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

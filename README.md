# Select Naija

Nigerian films and series for Nuvio and Stremio, in Yoruba, Igbo, Hausa, English, Pidgin and more, from
**legitimate sources only**. Select Naija is fully separate from Select DE: its own repo, server, address
and AIOStreams config.

## What it does

- **Its own catalogue.** Rows by language (Yoruba, Igbo, Hausa, English, Pidgin & other), series, new
  and classics, each filterable by genre, language, decade and free/subscription. Its own search, which
  ignores accents (Ọ̀ṣun = Osun). Titles with no TMDB or IMDb entry get a `snaija-<slug>-<year>` ID and a
  full detail page, so they are never second-class.
- **Three resolver layers** per title:
  1. TMDB watch providers (UK, powered by JustWatch), for catalogued titles only.
  2. Our own provider index (`data/links.json`): Kava, Circuits, Arewa24, Tubi, Plex and more.
  3. Open archives: rights-checked direct files that play inside Nuvio.
- **Verified links only.** Nothing is shown until the verifier has confirmed it.

## Link states

| State | Meaning | Shown? |
| --- | --- | --- |
| verified | Right title, page/file OK, checked in the last 7 days | Yes |
| stale | Verified before, last pass older than 7 days | Yes, ranked lower |
| failing | Last two checks failed | No |
| unverified | Never confirmed | No |

An external link passes only if the page loads, names the expected title and carries none of the
provider's "unavailable" wording (Tubi's page for a removed film still loads, so loading isn't enough).
A direct file passes only if the address really serves video; the verifier follows redirects and hands
Nuvio the final address.

## Provider score

0–100 = 60% link reliability over 30 days + 30% hand-checked accuracy (`data/accuracy.json`) + 10% freshness.
Below 80 a provider ranks lower; below 50 its links are hidden. A score only counts once it rests on
at least 10 checks in 30 days, so one dead link can't hide a whole provider.

## Reports and release gate

- `npm run verify`: checks every link politely (one request per site every 2 s) → `data/status.json`.
- `npm run report`: coverage per test group and per language, provider scores, gap list → `reports/`.
  A title counts as covered only with a verified Select Naija link; TMDB offers don't count.
- `node scripts/report.js --gate`: blocks a release if coverage drops more than 5 points anywhere, or a
  provider scores under 50.
- `npm test`: unit and route tests. The server only deploys code that passes them.

## Where checks run

Provider pages are region-locked, so they only count as verified when checked **from the UK**
(`ukCheckRequired` in `data/providers.json`). The first GitHub run proved why: Tubi's page for
*Buddy Goes to Nollywood* passed from GitHub's US servers while showing "Content unavailable" in the UK.

| Run | Where | Checks | Writes |
| --- | --- | --- | --- |
| Nightly GitHub Action | GitHub (US) | in-app files, which aren't region-locked | `data/status.json` |
| `scripts/verify-uk.ps1` | Fortune's PC (UK) | provider pages | `data/status-uk.json` |

The UK run refuses to start unless the connection really is in the UK (a VPN set elsewhere would give
false results). To run it nightly, in PowerShell:

```powershell
$a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$env:USERPROFILE\select-naija-checks\scripts\verify-uk.ps1`""
$t = New-ScheduledTaskTrigger -Daily -At 9pm
$s = New-ScheduledTaskSettingsSet -StartWhenAvailable
Register-ScheduledTask -TaskName 'Select Naija UK check' -Action $a -Trigger $t -Settings $s
```

## Server

`deploy/setup-micro.sh` sets up a dedicated Oracle E2.1.Micro server as a cloud-init script: Node 22,
Caddy with an `sslip.io` https address, a capped systemd service, and auto-deploy every 15 minutes
(code changes must pass tests; data changes reload without a restart). It must never be run on the
German server.

## Adding a title

1. Add it to `data/catalogue.json` (IMDb ID if one exists, otherwise `snaija-<slug>-<year>`), with the
   source of each field in `sources`.
2. Add its provider pages or files to `data/links.json` with the exact `expectTitle`.
3. Run `npm run verify` and `npm run report`. It appears in Nuvio once a link is verified.

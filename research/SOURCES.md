# Select Naija source register

Every candidate source of Nigerian films and series for UK viewers, assessed against the rules: free to
watch, legitimate (rights-holder or licensed platform), no YouTube, no paid services. Updated as probes run
(`research/probes.json`, results in `research/out/`).

| Source | Free in UK | Legitimacy | Size (Nigerian) | Languages | How it opens on Fire TV | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Tubi UK | Yes, ads | Licensed AVOD (Fox) | 98 titles: UK-only "Nollywood Naija Tales" collection (50 shown per visit, rotates; seen titles kept and re-checked) plus TMDB matches | Mostly English, some Yoruba/Hausa | Tubi app (title link to test) | **Live**, checked nightly from London |
| Prime Video free section (ex-Freevee, MX Player) | Yes, ads; Amazon account only | Licensed | 22 via TMDB | English | Prime Video app (link to test) | **Live** via TMDB |
| Plex free | Yes, ads | Licensed AVOD | 12 via TMDB | English | Plex app | **Live** via TMDB |
| BBC iPlayer, Channel 4 | Yes | Broadcaster | 3 | English | iPlayer / Channel 4 apps | **Live** via TMDB |
| Filmzie | Yes, ads | Licensed AVOD | 2 | English | Browser | **Live** via TMDB |
| Dailymotion: Extra Nolly TV (`realnollywoodmovies`) | Yes, ads | Dailymotion-verified partner channel | 5,720 videos → 1,641 films | English, some Igbo | Browser (Silk), tested: plays | **Live** (nightly) |
| Dailymotion: YORUBAWOOD (`yorubaplay`, iBAKATV's channel) | Yes, ads | Verified; official channel of distributor iBAKATV | 64 films | Yoruba | Browser (Silk) | **Live** (nightly) |
| Dailymotion: Yorubahood, NollyExtra | Yes | Partner but **not verified**; both UK accounts created the same minute in 2015, owner unconfirmed (iROKO's own brands are NollywoodLove and YorubaLove) | 482 / 178 | Yoruba / English | Browser | Hold until rights confirmed |
| NolliStream | Yes (AVOD) | Licensed; filmmakers upload directly | Unknown | Unknown | Mobile apps only; no web catalogue | Investigate catalogue access |
| KALLO (Hausa) | Yes, "free, always" | Spacekraft, launched as a Hausa platform | Unknown | Hausa | App (HLS) | Investigate: key for Hausa coverage |
| Northflix (Kannywood) | No (subscription) | Licensed | — | Hausa | — | Excluded (paid) |
| AfroLandTV | Yes ("watch free anywhere") | Licensed AVOD (content submission) | Unknown | Mixed African | Android TV app | Investigate catalogue access |
| BFI Player free | Yes | BFI | Few | English | Browser | Low priority |
| Internet Archive `nollywood_movies` | — | YouTube rips by third parties | — | — | — | **Excluded** (not rights-holders; YouTube) |
| Netflix, Prime Video subscription, Kava, IrokoTV, Circuits, Arewa24 On Demand | No | Licensed | — | — | — | Excluded (paid) |
| YouTube (incl. official channels) | — | — | — | — | — | Excluded by rule |

## UK check point

`uk-edge/` runs on Vercel's free plan in London (`lhr1`, confirmed: AWS eu-west-2, GB). The nightly run
reads Tubi UK and checks every region-locked provider page through it; it only fetches allow-listed
provider sites and needs a secret token. If it's down or not in the UK, checks fall back to JustWatch UK data.

## Open leads

- Tubi: deeper than the first 50 of a collection needs Tubi's app API (token); the rotating collection is
  accumulated instead for now.
- Hausa: KALLO (free) has no web catalogue; Arewa24 free content; more verified Dailymotion channels.
- Yoruba: confirm owners of Yorubahood / NollyExtra; NolliStream catalogue; AfroLandTV catalogue.

## In-app playability (tested 12 Nov 2026, `scripts/playtest.js`)

The requirement is playback inside Nuvio's own player, so each source was tested for a direct stream address.

| Source | Stream the source itself serves | Encrypted (DRM)? | Login/paywall? | Plays from another address? | In-app route |
| --- | --- | --- | --- | --- | --- |
| Tubi UK | Plain HLS (`hlsv6`), address in the public title page, no licence server | No | No | Yes: issued in London, played from the US; valid ~7 days | Server resolves through the London check point at request time |
| Dailymotion (approved channels) | Plain HLS from the public player metadata, `protected_delivery: false` | No | No | **No**: 403 from any other address | Resolve on the viewer's device (Nuvio plugin) or relay through the Select Naija server |
| Internet Archive (CC/public domain) | MP4 | No | No | Yes | Direct, but almost no Nollywood films with a reliable licence (447 hits, nearly all news, lectures, self-labelled uploads) |
| PeerTube (Sepia search) | MP4/HLS | No | No | Yes | Nothing Nigerian found |
| KALLO, AfroLandTV, NolliStream | App-only; no public web catalogue or API found | ? | Kallo: Wikipedia says subscription; site says free | — | Not reachable |
| Plex, Prime Video free, Netflix | Widevine DRM | Yes | Prime/Netflix: yes | — | Excluded |
| Existing Nollywood Stremio/Nuvio addons | Scrape unlicensed download sites (netnaija-type) | — | — | — | Excluded: not legitimate |

Trade-off to decide: Tubi and Dailymotion fund free films with ads shown by their own players. Playing their
plain streams in Nuvio involves no DRM, login or paywall, but skips those ads and is against both services'
terms of use, which only allow viewing through their apps and players.

## Authorisation check (12 Nov 2026)

**Dailymotion.** Terms of use: no automated access without Dailymotion's written approval (2.6), no
blocking ads (1.10a), no extraction without written authorisation from Dailymotion *or the uploader* (6.1 ix).
Authorised route: Dailymotion's API lets a channel owner, with a Private API key that has the "Generate
Stream URLs" permission, create stream addresses for their own videos, including addresses with
`no_ip_lock=1` and `no_expire=1` for delivery to their own audience. So an owner such as Extra Nolly TV or
iBAKATV could authorise and supply in-app streams. The IP lock seen in testing is the default for public
playback; it isn't something to work around.

**Tubi.** No public or third-party playback API. Its partner integrations are device platforms (Fire TV,
Roku) that open the Tubi app, plus ad-tech. Its terms bar automated access. Only route: license the films
from their owners (the distributors who supply Tubi), not from Tubi.



Scope: films and series only. Live TV is out of scope. Select Naija does not seek licences from rights-holders.

## ZeraTV (tested 14 Nov 2026, `scripts/probe-zeratv.js`, results in `research/out/zeratv.json`)

| Check | Result |
| --- | --- |
| Catalogue | 683 posts (Movies 672 over 56 pages; Yoruba 7; Igbo 4; no Hausa). Vimeo IDs date from 2017–2018 |
| Player per film | YouTube embed 386 (57%), Vimeo 243 (36%), other 43 |
| Vimeo owner | "Zera Media" account |
| Vimeo oEmbed (public video info) | 404 for all 12 tested: hidden from Vimeo's public listings |
| Vimeo player opened directly (London) | 403 for 11, 404 for 1: playback is locked to zeratv.com (domain-restricted embed) |
| Vimeo download | Not offered on any tested film |
| Vimeo API | Direct files (`play`, `files`, `download`) are only returned to the video owner's own token |
| ZeraTV terms | Claims no ownership of third-party content; allows only "a simple video embed"; "Unauthorized use … not allowed" |

Result: ZeraTV's Vimeo films can only be played on zeratv.com. Getting their streams into Nuvio would mean
defeating Vimeo's domain lock, so they are excluded unless Zera Media supplies streams. Its YouTube embeds
are third-party uploads; any from an approved official channel are already in the YouTube source.

## Round 3 leads (14 Nov 2026)

| Source | Tested | Result | Non-YouTube titles added |
| --- | --- | --- | --- |
| AVO TV (player.avo.tv, Tulix platform) | Web player in a browser; terms of service | Mostly live channels; films sit behind a log-in; terms: personal viewing only, no scraping, no redistribution or retransmission, no API or partner access | 0 |
| Aforevo Max (MBI) | mbi247.com, aforevo.com/max | App only; no web catalogue or player found (aforevo.com/max: 404) | 0 |
| Revo+ (MBI) | revoplus.com | Site refuses visitors (403); no live service found | 0 |
| Aflik TV | afliktv.com | Distributes to Amazon, Netflix, iTunes, Hulu, Vudu (paid or DRM) and its own YouTube channels: NollyReel, NollyNetwork, Movie More, Waka TV, Syworld TV, Nollyvids. The YouTube channels are added as approved rights-holder channels | 0 (YouTube channels added) |
| NaijasPride, Edimulo | Web and app-store search | No platform found under these names | 0 |

Rights-holder YouTube channels added this round: KAP Stream (Kunle Afolayan), NollywoodLove and YorubaLove
(iROKO), Biodun Stephen TV, Chioma Chukwuka TV, AMCChannels (African Movie Channel UK), Okiki Premium TV,
YorubaPlay (iBAKA), Scene One TV, and Aflik's six channels.

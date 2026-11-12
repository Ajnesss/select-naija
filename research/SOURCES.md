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
| Nolly Africa HD (African Movie Channel), live channel | Yes | Licensed FAST channel | 24/7 channel | English | Plex / Rakuten TV / Samsung TV Plus / Freeview | To add as a live-channel row |
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
- Live channels: Nolly Africa HD (Plex live TV page confirmed in the UK).

## In-app playability (tested 12 Nov 2026, `scripts/playtest.js`)

The requirement is playback inside Nuvio's own player, so each source was tested for a direct stream address.

| Source | Stream the source itself serves | Encrypted (DRM)? | Login/paywall? | Plays from another address? | In-app route |
| --- | --- | --- | --- | --- | --- |
| Tubi UK | Plain HLS (`hlsv6`), address in the public title page, no licence server | No | No | Yes: issued in London, played from the US; valid ~7 days | Server resolves through the London check point at request time |
| Dailymotion (approved channels) | Plain HLS from the public player metadata, `protected_delivery: false` | No | No | **No**: 403 from any other address | Resolve on the viewer's device (Nuvio plugin) or relay through the Select Naija server |
| Nigerian broadcasters' live channels (Free-TV list: Rave TV, Itage TV, Superscreen, Wazobia Max, Channels, TVC and more) | Public HLS published by the broadcaster | No | No | Yes | Direct |
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

**Live channels (per broadcaster).** Streams below are published by or for the broadcaster for free
viewing. None states third-party apps may use them; reliability depends on the address staying put.

| Channel | Content | Stream host | Assessment |
| --- | --- | --- | --- |
| Wazobia Max (Nigeria, Port Harcourt) | Pidgin, Hausa, Yoruba, Igbo entertainment | `wazobia.live` (broadcaster's own) | Strong candidate |
| News Central | News | `newscentral.ng` (own) | Candidate |
| Arise News | News | Arise's own CDN, on its live page | Candidate |
| Rave TV, Itage TV, Silverbird News 24, Advocate | Entertainment / news | ViewMedia (BozzTV) distribution accounts | Candidate; distributor-hosted |
| Superscreen TV | Entertainment | getstreamhosting (channel's hosting account) | Candidate |
| Waffi TV | Delta entertainment, Pidgin | 5centscdn (channel's hosting account) | Candidate |
| Channels TV, TVC News, Soundcity | News / music | YouTube only | Excluded (YouTube) |

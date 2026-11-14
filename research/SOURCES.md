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

## Round 4 (14 Nov 2026): MuviDB, African Movie Channel, Glo TV and title-level tracing

| Source | What was tested | Result |
| --- | --- | --- |
| MuviDB (muvidb.com) | Site and "where to watch" index rendered in a browser; developer API page | Film database (about 20,400 titles). Platforms it tracks: Netflix, Prime Video, YouTube, Kava, Docuth, EbonyLife ON Plus, Circuits, NolliStream, HomiTV, Filmporte. Every non-YouTube one is paid, app-only or rental (below). Bulk data needs its free Community API key; reading its internal database key was not used |
| HomiTV (homitv.com) | Film pages, subscription page, terms | Plain HLS files, but subscription only ($1/day, $3.99/month, $42/year, 7-day trial). Terms: personal use on Homi platforms only. **Excluded (paid)** |
| Docuth | Site | Pay-per-rental app. **Excluded (paid)** |
| Kava | Launch coverage, MuviDB links | Subscription (N1,500 / $2.99 per month, no free tier). **Excluded (paid)** |
| Filmporte | Film page | VHX storefront with account; earlier test failed. **Excluded** |
| African Movie Channel / AMCOP | Site, products page, platform list | Pay-TV channels plus the free Nolly Africa HD channel, which is live only (Freeview 287, Samsung TV Plus, Rakuten, LG, Plex, Distro). AMCOP originals are shown on those channels; no on-demand catalogue outside apps. Free AMC films are on its official YouTube channel (AMCChannels, 75 films, already included). **No new in-app source** |
| Glo TV (myglotv.com) | Web app rendered; app listing | Built on TV Anywhere Africa; app listing says the service is only for Globacom prepaid/postpaid subscribers in Nigeria. **Excluded (Nigeria SIM only)** |
| Odysee (re-checked) | Channel survey | Nigerian films there are re-uploads by third parties; stream URLs return 401 to outside players. **Excluded** |

Title-level tracing: every platform MuviDB records for a film was checked. None offers a free, permitted in-app stream in
the UK, so tracing individual YouTube films to those platforms adds 0 non-YouTube playable titles. The nightly report now
counts unique non-YouTube playable titles separately, so any future source shows up on its own line.

## Round 5 (14 Nov 2026): El's Movies, NolliStream recheck, Vuma+, FilmFlux

| Source | What was tested | Result |
| --- | --- | --- |
| El's Streaming (elsmovies.com/stream) | Home, film list, two film pages rendered in a browser; FAQ; terms; WordPress API index | WordPress site, free fan registration. Catalogue: 7 films (Awuf Wife, What Men Want, Divided Heart, Wicked Princes, Madam Hoha, Driver Lover, Face Mask). Every film page plays a **YouTube embed** (e.g. Awuf Wife = youtube `axdlxPY1_3A`, uploaded by El's own channel EL'S NOLLY TV, @elsnollytv77). No self-hosted files, no HLS/MP4. Terms are a template copied from "Digiflex". **Integrated via its official YouTube channel** (rights-holder) |
| NolliStream (nollistream.net, app v10) | Web home and two film pages rendered | Free AVOD, but every page redirects to a sign-up wall; app v10 notes "tightened security". Playback only after an account login inside its apps/web, ad-funded; no public API or partner feed. **Excluded** (account-gated, ad-supported player; streaming into Nuvio would strip its ads) |
| Vuma+ (vumaplus.com) | Home, browse, terms; data calls | Its own terms: "Content is streamed via YouTube's embedded player"; catalogue table is `yt_catalog` of YouTube video IDs from many channels (official and fan re-upload). **No independent source** |
| FilmFlux (filmflux.app) | Site (Cloudflare bot wall), App Store listing | Listing: films "picked from the best YouTube creators". **No independent source** |

## Round 6 (14 Nov 2026): video infrastructure behind Nigerian producer and distributor websites

Method: `scripts/infra-probe.js` (workflow "Research infrastructure probe") opens each site's home page and up to five
film/video pages in headless Chromium and fingerprints what the page loads: Bunny Stream, Cloudflare Stream, Mux,
JW Player, Vimeo/VHX, Wistia, Brightcove, api.video, Dacast, VdoCipher, Kaltura, cloud storage (S3/Spaces/Linode),
plain MP4/HLS/DASH and DRM licence calls. 40 sites tested in two batches.

| Finding | Sites |
| --- | --- |
| Own hosting found | **Olaniitv**: Bunny Stream MP4 (`vz-….b-cdn.net/<id>/play_1080p.mp4`), but its own page says it is a subscription service. **kweliTV**: own MP4/HLS, subscription. **HomiTV** (round 4): Linode HLS, subscription |
| YouTube embeds only | Anthill Studios, FilmOne, Nemsia Studios, iRep, NollywoodWeek, AfriDocs (plus one Vimeo), El's Movies (round 5) |
| No player / rental or ticket sites | Blue Pictures (cinema listings, Instagram clips), Gidi Box Office (rent), Trino Studios (rent), Kunle Afolayan (rent/buy), AFRIFF (tickets), AbidonTV (subscribe/rent), Ndani.tv (sign-in/rent), Afrinolly, Greoh, Scene One, OTTera (B2B site) |
| Bot wall or offline | TvNolly, Lights Camera Africa, Documentary Africa, NaijaPals, EbonyLife ON Plus, cAfrica (Cloudflare/403); NollyLand 401; Mount Zion 522; RED TV, Accelerate TV, Mainframe, MZFMI, nvivo, AFree TV, MTN One TV, eVOD, FreeVision Play (domains not resolving) |

AVAZ: OTTera and Blue Pictures' Nollywood channel is a 24-hour FAST channel (live) on FAST platforms. `avaz.tv` is an
unrelated Bosnian news site, and Blue Pictures' own "Avaz" page is its restaurant (Avaz Kitchen). No on-demand library
or feed found. Result: no free, permitted, directly playable source in this round.

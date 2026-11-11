# Select Naija source register

Every candidate source of Nigerian films and series for UK viewers, assessed against the rules: free to
watch, legitimate (rights-holder or licensed platform), no YouTube, no paid services. Updated as probes run
(`research/probes.json`, results in `research/out/`).

| Source | Free in UK | Legitimacy | Size (Nigerian) | Languages | How it opens on Fire TV | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Tubi UK | Yes, ads | Licensed AVOD (Fox) | Large; launched in UK with a Nollywood focus. ~57 matched via TMDB so far | Mostly English, some Yoruba | Tubi app (title link to test) | **Live** via TMDB; full catalogue needs a UK vantage point |
| Prime Video free section (ex-Freevee, MX Player) | Yes, ads; Amazon account only | Licensed | 22 via TMDB | English | Prime Video app (link to test) | **Live** via TMDB |
| Plex free | Yes, ads | Licensed AVOD | 12 via TMDB | English | Plex app | **Live** via TMDB |
| BBC iPlayer, Channel 4 | Yes | Broadcaster | 3 | English | iPlayer / Channel 4 apps | **Live** via TMDB |
| Filmzie | Yes, ads | Licensed AVOD | 2 | English | Browser | **Live** via TMDB |
| Dailymotion: Extra Nolly TV (`realnollywoodmovies`) | Yes, ads | Dailymotion-verified partner channel | 5,862 videos (films often split into parts) | English | Browser (Silk) | **Next: integrate** |
| Dailymotion: YORUBAWOOD (`yorubaplay`, iBAKATV's channel) | Yes, ads | Verified; official channel of distributor iBAKATV | 67 full Yoruba films | Yoruba | Browser (Silk) | **Next: integrate** |
| Dailymotion: Yorubahood, NollyExtra | Yes | Partner but **not verified**; rights unclear | 482 / 178 | Yoruba / English | Browser | Hold until rights confirmed |
| Nolly Africa HD (African Movie Channel), live channel | Yes | Licensed FAST channel | 24/7 channel | English | Plex / Rakuten TV / Samsung TV Plus / Freeview | To add as a live-channel row |
| NolliStream | Yes (AVOD) | Licensed; filmmakers upload directly | Unknown | Unknown | Mobile apps only; no web catalogue | Investigate catalogue access |
| KALLO (Hausa) | Yes, "free, always" | Spacekraft, launched as a Hausa platform | Unknown | Hausa | App (HLS) | Investigate: key for Hausa coverage |
| Northflix (Kannywood) | No (subscription) | Licensed | — | Hausa | — | Excluded (paid) |
| AfroLandTV | Yes ("watch free anywhere") | Licensed AVOD (content submission) | Unknown | Mixed African | Android TV app | Investigate catalogue access |
| BFI Player free | Yes | BFI | Few | English | Browser | Low priority |
| Internet Archive `nollywood_movies` | — | YouTube rips by third parties | — | — | — | **Excluded** (not rights-holders; YouTube) |
| Netflix, Prime Video subscription, Kava, IrokoTV, Circuits, Arewa24 On Demand | No | Licensed | — | — | — | Excluded (paid) |
| YouTube (incl. official channels) | — | — | — | — | — | Excluded by rule |

## Infrastructure gap

Region-locked catalogues (Tubi above all) can only be read correctly from a UK internet address. GitHub
(US) and the Oracle server (Frankfurt) can't. Candidate free UK vantage point: a serverless function pinned
to London (for example Vercel's free Hobby plan, region `lhr1`), called by the nightly run.

# VP Radar — ValuePickr "Stock Opportunities" tracker

Open `site\index.html` in any browser. Double-click `refresh.bat` to re-scrape and reopen it. Re-runs are fast because everything is cached in `cache\`.

Everything on the site comes from ValuePickr: posts, comments, likes, views and authors. Yahoo Finance prices are used only to measure how a call played out and where the price sits now. The category is public, so no login is used or needed.

## Hosted, auto-refreshing version (GitHub Pages)
`.github/workflows/refresh.yml` runs the scraper on GitHub's servers every 6 hours and publishes `site/` to GitHub Pages. Your PC doesn't need to be on.
1. Create an empty **public** repo, e.g. `vp-radar`, at https://github.com/new. Don't add a README.
2. In this folder: `git remote add origin https://github.com/<you>/vp-radar.git` then `git push -u origin main`. A browser login pops up the first time.
3. In the repo, go to **Settings → Pages → Source: GitHub Actions**.
4. Go to **Actions → Refresh VP Radar → Run workflow**. The first run takes about 15–25 minutes; later runs are faster.
5. Your link is `https://<you>.github.io/vp-radar/`. The header shows "data as of" for the last refresh.

## Tabs
| Tab | What you get |
|---|---|
| **Latest posts** | Newest threads. You can sort by post date (the forum can't), last activity, forum verdict, multibagger potential, likes, replies, views, comment mood or price since post. Each row has date-range and verdict filters. Click a row for the summary of the original post (key points, numbers quoted, triggers, risks), the full post, the latest 5 comments, and the author's other threads and record. |
| **Track record** | Older threads (≥ 1 yr): price on the day the thread started vs today, compared with the Nifty 50 over the same period. Outcomes: Multibagger / Spot on (CAGR ≥ 18% and beat Nifty) / Beat Nifty / Lagged / Loss. It also shows what the thread is saying now. |
| **Authors** | Leaderboard of who has been right before (hits, multibaggers, median CAGR), plus each author's latest threads so you can follow them. |
| **Worked → act now?** | Calls that already worked: today's forum mood plus the price versus its 52-week high. You get a read for new money (accumulate zone / at highs / wait, don't chase / avoid) and for holders. |

## How the forum verdict is built (ValuePickr only)
- **Multibagger potential** (0–100) is made of four parts:
  - multibagger language in the post and comments (re-rating, operating leverage, capacity expansion, order book, monopoly or niche, runway, tailwinds…), up to 40
  - engagement (likes, views), up to 25
  - the author's past hit rate in this category, up to 20
  - the mood of the latest comments, up to 15
- **Forum verdict** = 45% multibagger potential + 35% mood of the latest comments (weighted by likes) + 20% conviction of the original post.
  - ≥ 62 → *Buy-side · forum bullish*
  - ≥ 46 → *Watch*
  - otherwise → *Sell-side*
  - Bearish latest comments always force *Sell-side · forum turned cautious*.

These are keyword heuristics meant to point your own research, not advice.

## Options
```
refresh.bat -Latest 100          # analyse the newest 100 threads (default 60)
refresh.bat -TrackTopics 600     # judge more older calls (default 250 most-discussed)
refresh.bat -PerAuthor 30        # older threads per author of a latest post (default 15)
refresh.bat -NoCache             # ignore cache
```

## Fixing a wrong ticker match
Thread titles are matched to tickers automatically. To fix one, edit `config\overrides.json`: `"<topic id>": "<NSE symbol or BSE code>"`, or `null` if the thread isn't about a listed company.

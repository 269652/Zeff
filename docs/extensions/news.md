# News

> Your news, gathered from public feeds and scored for you — your interests, muted words, trusted sources, freshness, what you liked before and, if you want, what your open todos are about. **Category:** app · **On by default:** no · **Beta:** no · **Needs:** nothing; the AI features need [LLM](llm.md)

![The News page before any source: the views For you, Discover, Latest, Saved, Hidden with Refresh, Discover and News settings on the left; on the right the day's line "Today 0 in → scored for you · 0 kept" with "Filter with an agent …", the "Ask your news" box and "Start with the starter pack"](img/news-overview.png)

## For users

### What it does

Thousands of headlines are published every day; a few dozen are worth your time. News fetches the feeds you pick
(Tagesschau, heise, Hacker News … or any RSS/Atom address) plus one Google News search per interest, and orders
everything by how well it fits **you**. Every card says why it is there ("Formula 1 ×2", "work: T-132", "fresh",
"profile: Rennrad · Paula"). You read, save, hide, like (👍) or dislike (👎); it learns from that.

With the [LLM](llm.md) plugin it can also: write a daily overview of the best unread news, act as an editor that
filters what reaches *For you* (the funnel), tag headlines and group them into stories, answer questions from the
news you collected with sources, keep a written description of your taste, and find new feeds.

Everything is fetched from public feeds. Nothing of yours is sent except the feed address — unless you switch on an
AI feature, which sends headlines (and your interests/taste) to the AI backend you chose.

The demo data has no news sources, so the screenshot above shows the empty start: the day's funnel line (how many
came in, how many were scored for you, how many were kept), *Ask your news*, and **Start with the starter pack**.
The feed fills after you add sources and the first sync runs.

### Getting started

1. **Menu → Plugins**, switch on **News**.
2. Open **Settings → News** (`/settings/news`). Either name a few **Interests** (one per line; `Formula 1 x2`
   counts double) — Zeff then searches Google News for each — or add sources: the **starter pack**, a whole
   category or single outlets from the catalog, a feed address of your own, or **Find feeds** for a topic.
3. Open **News** (under *Apps* in the menu, `/news`) and press **Refresh**. The sync fetches every enabled source,
   scores the items and keeps fetching (adding sources from the catalog, then the internet search) until there are
   about 200 unseen cards or the sources run out.

After that the `news` sync step runs on its own interval (Sync settings).

![News settings, top of the page: "What suits you" with the Funnel box (An agent filters my news, The agent reads per round 60, Keep the newest and best 300), Interests (placeholder "TypeScript x2, Formel 1, Klimaschutz"), Not interested in ("Horoskop, Promi"), Feeds per round 150, Language Deutsch, Show the last 7 days, Items per source 25, Keep for 30 days, and the first switches](img/news-settings.png)

### Using it

**Views** (left): **For you** (unread, best first — with the funnel on, only what the agent let through), **✨
Discover** (unread news matched against your written taste), **Latest** (everything by time; *Everything
(unfiltered)* when the funnel is on), **Saved**, **Filtered out** (what the agent dropped, kept a day), **Hidden**.
Under them the **categories** of your enabled sources.

**Stories** at the top of *For you*: round pictures like a story strip — "Important" first (what the agent marked
important and the best report of each big story), then the stories running through your news, each told from its
first report to its latest. Tap one and it plays; hold to pause.

**A card** shows the headline, source, age, picture (optional), summary and the reasons for its score. Its buttons:

| Button | What it does |
| --- | --- |
| Read / Read here | fetches the article and shows its text in Zeff, without the site's ads and scripts |
| 🔖 Save for later | keeps it (saved items are never cleared away) |
| 👍 / 👎 | teaches the scoring (the headline's words) and your taste; 👍 on a filtered item tells the agent it was wrong |
| More like this | the card flies to the centre while the AI says why it fits you and searches for similar articles; the finds appear below it |
| Hide | removes it from the views |
| Thread / Follow the thread | the story it belongs to (how many outlets report it), in the feed |
| Listen | reads it aloud with your browser's voice |
| Pause / Stop this feed / Stop this topic | pauses or removes the source, or the interest search it came from |

**Refresh** fetches every source and tops up to 200 unseen cards in the background with its progress shown.
**Overview now** builds the AI overview (when on); it can be listened to. **Let the agent look now** runs the
funnel over what is waiting. **Ask the news** answers a question ("What is new in quantum computing this week?")
from the collected news, each statement with a numbered link to its source. **Discover** plans searches from your
taste, finds and fetches new sources, then opens the Discover view with the matches.

### Settings

`/settings/news`. Stored as one preference (`news:prefs`); defaults in brackets.

| Setting | What it changes |
| --- | --- |
| An agent filters my news [off] | the funnel: after every fetch the AI reads the best new headlines with your taste, interests and likes and lets only what interests you through to *For you* (pass / top = important / drop, each with a why) |
| The agent reads per round [60] | how many new headlines (best by score) go to the agent per fetch |
| Keep the newest and best [300] | besides what you keep, this many of the newest and of the best stay; the rest is cleared after each fetch (and not brought back by a feed that still carries it) |
| Interests | one per line; `x2`/`x3` weights it; also one search per interest |
| Not interested in | items with one of these words are left out (score −100) |
| Feeds per round [150] | a round fetches this many feeds, the longest-unfetched first |
| Language of the searches [de] | German, English or both |
| Show the last … days [7] | older items aren't fetched or shown |
| Items per source [25] | most items kept per source and fetch |
| Keep for … days [30] | how long read items are kept (saved ones always) |
| Search for each interest [on] | one Google News search per interest (the eight that count most) |
| Use my work [on] | news about what your open todos and tickets are about comes first (compared on this PC) |
| Find new feeds by itself [on] | once a day searches feeds for two of your interests and adds the best few (category *Discovered*); also when fresh news run low |
| Show pictures [on] | each picture is loaded by your browser from its news site (that site sees you looked) |
| Read ahead [on] | after each fetch reads the whole text of the best unread items so they open at once |
| Use what Zeff knows about me [on] | your facts, open todos and tickets are matched against headlines (on this PC) |
| Mix it up [on] | no run of one source, one outlet per story near the top, every seventh place something different |
| AI tags and stories [on] | the AI tags the best unseen headlines (people, places, companies, topics, story); else the built-in tagger |
| AI overview [off] | after each fetch the AI sums up the best unread items and why they fit you |

Further sections on the page: **Sources** (each with *Trust* low/normal/high/first, *Pause/Resume*, *Remove*, its
last fetch or error and votes), **Add source** (name + feed address), **Find feeds** (a topic → checked feeds with a
reason and latest headlines, one click to add), **Found by itself** (what auto-discovery added), **Your taste** (the
written description with *Likes* and *Avoids*, *Save my version*, *Update from my likes now*, *Forget the
description*), **How it learns** (forget what the votes taught), and the catalog of outlets and topic packs by
category and language. The sync interval is under **Sync settings → News**.

### Tips & limits

- **Privacy:** fetching sends only the feed address (and Zeff's user agent). *Use my work* and *Use what Zeff knows
  about me* compare words on your PC. The AI features send headlines, your interests and your taste description to
  your AI backend. *Find new feeds* sends interests and AI-named outlets to the search. Pictures are loaded by your
  browser from the news sites.
- A source you keep disliking is paused by itself; a source that keeps failing is tried only once a day.
- With the funnel on, the stream is meant to be small: no extra feed hunting when it runs low.
- *Read here* uses a small readability heuristic; pages behind a paywall can't be read. Google News links are
  resolved to the publisher first.
- The scoring, in short: interest in the headline +3×weight (in the summary +1.5×weight); learned words ±4 at most;
  work +1.5 per hit (max 3); profile up to +4; the positive part is scaled by the source's trust and votes; fresh up
  to +2, fading over about two days.

## Technical reference

### Overview

The sync (`syncNews`) picks the `perRun` longest-unfetched enabled sources, fetches them eight at a time (with ETag /
Last-Modified), parses RSS 2.0 / RSS 1.0 / Atom with a small tolerant reader (`feed.ts`), keeps new items, and
rescores everything (`scoreItem` in `shared.ts`) with your prefs, learned word scores (`news_terms`), work words and
profile terms. Then, optionally: the funnel (AI gate), trimming to the newest/best `keepLatest` (tombstones in
`news_gone`), reading ahead, tagging (corpus tagger always — n-gram keyphrases with PMI, stemming, a gazetteer, name
heuristics, normalisation — and AI tags for a batch), the digest, and feed hunting when fresh news run low (catalog
first via `expand.ts`, then the internet finder). Stories are built by leader clustering of TF-IDF vectors
(`cluster.ts`).

```mermaid
flowchart TD
  S[sync step "news"] --> D[auto-discover once a day]
  D --> F[fetch perRun feeds, 8 at a time]
  F --> K[keep new items] --> R[rescore all]
  R --> G{funnel on?}
  G -->|yes| A[AI gate: pass / top / drop]
  G -->|no| T
  A --> T[trim to newest + best, tombstones]
  T --> P[read ahead best unread]
  P --> TG[corpus tags + AI tags]
  TG --> DG[AI overview if on]
  DG --> L{unseen low?}
  L -->|yes| X[catalog → finder → fetch again]
```

### Manifest

| Field | Value |
| --- | --- |
| id | `news` |
| category | `app` |
| order | 180 |
| defaultInstalled | `false` |
| dependsOn | none (AI features check for `llm`) |
| settings | `/settings/news` — "Sources, interests, muted words, how it learns" |
| apps | `/news` — "Your news, scored for you" |
| routes | `/news`, `/settings/news` |
| syncSteps | `news` |
| features, extensions | none |

### Files

| File | What it is |
| --- | --- |
| [plugin.ts](../../src/plugins/news/plugin.ts) | the manifest |
| [shared.ts](../../src/plugins/news/shared.ts) | types, prefs and defaults, presets, `scoreItem`, `diversify`, topic search URLs |
| [store.ts](../../src/plugins/news/store.ts) | tables, prefs, items, sources, views, counts, funnel stats |
| [sync.ts](../../src/plugins/news/sync.ts) | `syncNews`, `rescoreAll`, work words |
| [feed.ts](../../src/plugins/news/feed.ts) | RSS/Atom reader |
| [http.ts](../../src/plugins/news/http.ts) | fetch with Zeff's user agent |
| [reader.ts](../../src/plugins/news/reader.ts), [peek.ts](../../src/plugins/news/peek.ts) | article text and picture |
| [funnel.ts](../../src/plugins/news/funnel.ts) | the AI gate |
| [digest.ts](../../src/plugins/news/digest.ts) | the AI overview |
| [ask.ts](../../src/plugins/news/ask.ts) | questions answered from the news, with sources |
| [taste.ts](../../src/plugins/news/taste.ts) | the written taste description |
| [similar.ts](../../src/plugins/news/similar.ts) | "More like this" |
| [retag.ts](../../src/plugins/news/retag.ts), [keyphrase.ts](../../src/plugins/news/keyphrase.ts), [nlp.ts](../../src/plugins/news/nlp.ts), [names.ts](../../src/plugins/news/names.ts), [gazetteer.ts](../../src/plugins/news/gazetteer.ts), [normalize.ts](../../src/plugins/news/normalize.ts) | tagging without and with AI |
| [cluster.ts](../../src/plugins/news/cluster.ts), [story-groups.ts](../../src/plugins/news/story-groups.ts) | stories |
| [profile.ts](../../src/plugins/news/profile.ts) | facts, todos and tickets as score terms |
| [discover.ts](../../src/plugins/news/discover.ts), [finder.ts](../../src/plugins/news/finder.ts), [auto-discover.ts](../../src/plugins/news/auto-discover.ts), [expand.ts](../../src/plugins/news/expand.ts), [discover-job.ts](../../src/plugins/news/discover-job.ts), [refresh.ts](../../src/plugins/news/refresh.ts) | finding feeds, topping up, Discover and Refresh jobs |
| [catalog.ts](../../src/plugins/news/catalog.ts), [catalog-data.ts](../../src/plugins/news/catalog-data.ts), [topics.ts](../../src/plugins/news/topics.ts) | stock catalog (generated by `scripts/news-catalog.mts`) and topic packs |
| [server-actions.ts](../../src/plugins/news/server-actions.ts) | card buttons, jobs, settings forms |
| [widgets.ts](../../src/plugins/news/widgets.ts), [workspace-source.ts](../../src/plugins/news/workspace-source.ts), [server.ts](../../src/plugins/news/server.ts) | contributions to the Workspace |
| [NewsFeed.tsx](../../src/plugins/news/NewsFeed.tsx), [NewsCard.tsx](../../src/plugins/news/NewsCard.tsx), [Stories.tsx](../../src/plugins/news/Stories.tsx), [MagicStage.tsx](../../src/plugins/news/MagicStage.tsx), … | the UI |
| [src/app/news/page.tsx](../../src/app/news/page.tsx), [src/app/settings/news/page.tsx](../../src/app/settings/news/page.tsx) | the pages |

### Data

| Table / pref | Fields |
| --- | --- |
| `news_sources` | `name`, `url` (unique), `enabled`, `weight` (trust), `votes`, `last_at`, `last_error`, `category`, `lang`, `etag`, `modified`, `fails`, `created_at` |
| `news_items` | `source_id`, `source_name`, `guid`, `url`, `url_key` (unique), `title`, `title_key`, `summary`, `published_at`, `fetched_at`, `state` (new/read/saved/hidden), `vote`, `score`, `reasons` (JSON), `image`, `tags` (JSON), `story`, `tag_src`, `seen_at`, `content` (read-ahead text), `gate` (''/pass/top/drop), `gate_why`, `gate_at` |
| `news_terms` | learned word scores from your votes |
| `news_similar` | "more like this" finds: `item_id`, `like_of`, `score`, `why` |
| `news_gone` | tombstones of cleared items (`url_key`, `title_key`) so a feed doesn't bring them back |
| pref `news:prefs` | the settings above (`NewsPrefs`) |

The taste description, digest and job progress are kept by their modules (`taste.ts`, `digest.ts`, `refresh.ts`,
`discover-job.ts`).

### Sync, jobs & AI tasks

- **Sync step `news`** ([registry](../../src/lib/sync/registry.ts)): runs `syncNews()`, interval from Sync
  settings, window "always".
- **Background jobs** started from the page: Refresh (`refresh.ts`), Discover (`discover-job.ts`), funnel rounds
  (`funnel.ts`), each reporting progress to its button.
- **AI tasks** ([llm-tasks.ts](../../src/plugins/news/llm-tasks.ts)), each with its own backend/model in the LLM
  settings and its prompt a page of *System → Prompts*:

| Task | What it does |
| --- | --- |
| `news-digest` | sums up the best unread news of the day and why each pick fits |
| `news-funnel` | reads the best new headlines like an editor and lets only what interests you through (a fast model is enough) |
| `news-ask` | answers a question from the collected news, each statement with its source |
| `news-discover` | plans searches for new news from your taste |
| `news-retag` | canonical names, topics and story labels for the best new headlines |
| `news-similar` | why an article fits you and searches for similar ones |
| `news-taste` | rewrites the taste description from likes, saves and rejections |
| `news-feeds` | names outlets, blogs and newsletters on a topic (Zeff then finds and checks their feeds) |

### MCP tools & actions

None of its own: no `mcp.ts`, no todo actions. The page's server actions are in
[server-actions.ts](../../src/plugins/news/server-actions.ts) (`newsStateAction`, `newsVoteAction`,
`newsReadAction`, `askNewsAction`, `startRefreshAction`, `startDiscoverAction`, `findFeedsAction`, the settings
forms …). Kept news reach agents through the Workspace source below.

### Extension points

Contributes to two [Workspace](workspace.md) points ([server.ts](../../src/plugins/news/server.ts)):

- `workspaceSources` — source `news`: the news you kept (saved or liked) as a database for pipelines and agents
  (Publisher, Published, Score, Saved, Liked …). Two-way: unchecking *Saved* there unsaves it in News.
- `workspaceWidgets` — widget `news.top`: the best new items with Save / More like this / Hide buttons (setting:
  how many, 1–15).

### Tests

- [tests/news.test.ts](../../tests/news.test.ts) — feeds, scoring, sync, tagging, stories
- [tests/news-funnel.test.ts](../../tests/news-funnel.test.ts) — the funnel and trimming
- [tests/workspace-news.test.ts](../../tests/workspace-news.test.ts) — the Workspace source

Run one with `node --import tsx --test tests/news.test.ts`.

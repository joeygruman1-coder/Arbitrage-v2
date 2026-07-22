# Crossmark

Crossmark is a read-only prediction-market intelligence dashboard. It repeatedly downloads the open catalogs from **Polymarket US** and Kalshi, finds likely equivalent questions, and shows **one Polymarket US contract linked to one Kalshi contract**. It does not connect a wallet or place trades.

## Clean replacement scope

This branch uses the safe, reviewable cleanup approach: the former application code is deleted from the repository's **current version** and replaced by this focused linker. Only the files listed in [Commands and files](#commands-and-files) make up the application. GitHub will continue to retain earlier commits in repository history for audit and recovery; a normal pull request intentionally does not rewrite or destroy that history.

## Beginner setup

### 1. Install Node.js

Node.js runs the app on your computer. Download the **LTS** installer from [nodejs.org](https://nodejs.org), accept its default choices, then open Terminal (macOS) or PowerShell (Windows). Check the installation:

```bash
node --version
npm --version
```

Node should report version 18 or newer.

### 2. Open this project in a terminal

Download this repository as a ZIP, unzip it, type `cd ` (with a trailing space) in Terminal, drag the unzipped folder into the window, and press Enter. For example:

```bash
cd ~/Downloads/Arbitrage-v2
```

There are no third-party packages to install. The app uses only features included with Node.js.

### 3. Start the local website

```bash
npm start
```

Keep that terminal open and visit [http://localhost:3000](http://localhost:3000). “Localhost” means the site is available only on your computer. Press **Control+C** in the terminal to stop it. Use `npm run dev` instead when editing; it restarts after file changes.

The first full scan can take a minute because the server follows every page of both public catalogs. It rescans every five minutes, and the **Scan now** button starts an immediate refresh.

### Railway deployment

The included `railway.json` starts the Node server and checks `/health`. The server binds to Railway's injected `PORT` on `0.0.0.0`, responds to web traffic immediately, and runs the expensive match calculation in a worker thread so a catalog scan cannot block Railway's router. No Railway variables are required for read-only operation.

## API keys, explained simply

An API lets programs exchange structured data. An **API key** is a secret password identifying your program to an API. A key may grant access or create charges, so never paste one into chat, browser JavaScript, or GitHub.

Polymarket US and Kalshi expose the read-only market catalog data used here publicly, so **you need no exchange keys**. This prototype cannot trade.

The app uses the exchanges' documented public production endpoints:

* `https://gateway.polymarket.us/v1/markets` — the Polymarket US gateway (not the international Gamma API). Its response is an object containing a `markets` array and uses `limit`/`offset` pagination.
* `https://external-api.kalshi.com/trade-api/v2/markets` — Kalshi's recommended external Trade API host. Its response uses cursor pagination.

Transient `429` and server responses are retried with exponential backoff, and catalog page requests are paced. For a proxy, mirror, or test fixture, set `POLYMARKET_API` or `KALSHI_API` to an alternate base URL before starting the server.

### Optional AI review

The built-in matcher works without AI or any paid service. It creates a fast shortlist by comparing words, names, dates, numbers, percentages, and directions. You may optionally let an OpenAI model conservatively review the first 30 proposed pairs on each scan:

1. Create an API key in the OpenAI developer platform and enable API billing. ChatGPT subscriptions and API billing are separate.
2. Copy `.env.example` to a new file named `.env`.
3. Add the key after `OPENAI_API_KEY=` in `.env`. Do not use quotes or spaces.
4. Start with the private values loaded:

**macOS / Linux**

```bash
set -a; source .env; set +a; npm start
```

**Windows PowerShell**

```powershell
$line = Get-Content .env | Where-Object { $_ -like 'OPENAI_API_KEY=*' }
$env:OPENAI_API_KEY = $line.Split('=', 2)[1]
npm start
```

`.gitignore` excludes `.env`. If a key is exposed, revoke it immediately and generate another. AI calls cost money, can be wrong, and are not a substitute for reading both exchanges’ resolution rules.

## How matching works

1. **Collect:** the server paginates until each exchange says there are no more open markets, removes duplicate IDs, and repeats on a timer.
2. **Shortlist:** a keyword index avoids comparing every possible pair.
3. **Guard:** a candidate is rejected if numeric thresholds or directional words conflict. It must share at least two meaningful title words.
4. **Rank:** title and description overlap produce a confidence score.
5. **Link once:** candidates are considered from strongest to weakest; after either market is claimed, it cannot appear in another pair.
6. **Review (optional):** an AI pass checks the proposition’s subject, threshold, time window, direction, and settlement meaning.

The result is a suggestion, not proof. Similar titles can still have different deadlines, sources, edge cases, or settlement rules. Always open and read both contracts.

## Commands and files

| Command | Purpose |
| --- | --- |
| `npm start` | Start the dashboard at `http://localhost:3000` |
| `npm run dev` | Start with automatic restart after edits |
| `npm test` | Run matching safety tests |

| File | Purpose |
| --- | --- |
| `server.js` | Public API pagination, background refresh, optional AI review, and web server |
| `matcher.js` | Normalization, candidate scoring, conflict guards, and one-to-one selection |
| `public/` | Local dashboard |
| `test/` | Automated matcher tests |

## Next steps (not implemented yet)

- Save human approvals and rejections in a database.
- Compare complete resolution rules and closing times more deeply.
- Add manual link/unlink controls and an audit history.
- Only after equivalence is reliably verified, collect executable order books and calculate fee-aware arbitrage.
- Add authentication and encrypted exchange credentials only when trading is intentionally introduced.

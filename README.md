# Market Twin

Market Twin downloads popular open markets from **Polymarket** and **Kalshi**, compares every possible pair, and ranks likely equivalents in a local web dashboard. It is the first building block for a future arbitrage tracker—it does **not** place trades.

## Start here (no coding experience required)

### 1. Install Node.js

Node.js is the program that runs this app. Download the current **LTS** version from [nodejs.org](https://nodejs.org), install it with the default choices, and then open Terminal (macOS) or PowerShell (Windows).

Check that it worked:

```bash
node --version
```

You should see version 18 or higher.

### 2. Download and open this project

Download the repository as a ZIP and unzip it. In Terminal, type `cd ` (including the space), drag the unzipped folder into the terminal window, and press Enter. Your command will look something like:

```bash
cd ~/Downloads/Arbitrage-v2
```

### 3. Launch the app

This version has no third-party packages, so there is nothing else to install. Run:

```bash
npm start
```

Keep that terminal window open. Visit [http://localhost:3000](http://localhost:3000) in Chrome, Safari, or Edge. `localhost` means “this computer”—the app is not public on the internet. Stop it at any time by returning to Terminal and pressing **Control+C**.

For development, `npm run dev` automatically restarts the server after a code change.

## What is an API key?

An API is a structured way for one app to request information from another. An **API key** is a secret password that identifies your app to a service. It can sometimes incur charges, so never paste it into a chat, commit it to Git, or put it in browser code.

The market data used here is public, so **you do not need Polymarket or Kalshi keys** for this read-only prototype. The built-in matcher works without any key. An OpenAI key is optional and adds an AI review pass to the strongest candidate pairs.

### Optional: enable OpenAI review

1. Create an API key in your OpenAI developer account and ensure API billing is enabled. A ChatGPT subscription and API billing are separate.
2. In the project folder, duplicate `.env.example` and name the copy `.env`.
3. Put the key after `OPENAI_API_KEY=`. Do not add spaces or quote marks.
4. Load that private file before starting the app:

   **macOS / Linux**
   ```bash
   set -a; source .env; set +a; npm start
   ```

   **Windows PowerShell**
   ```powershell
   $env:OPENAI_API_KEY=(Get-Content .env | Select-String 'OPENAI_API_KEY=').ToString().Split('=',2)[1]; npm start
   ```

The `.gitignore` file prevents `.env` from being committed. If a key is ever exposed, revoke it immediately on the provider's dashboard and create a new one.

## How matching works

1. The server requests up to 100 currently open markets from each exchange's public API and caches results for five minutes.
2. It standardizes titles and compares important words, proper names, categories, thresholds, years, and other numbers.
3. Candidate pairs receive a confidence score and are ranked in the UI.
4. When `OPENAI_API_KEY` is present, the strongest 20 candidates receive a conservative AI review that checks the event, subject, threshold, time window, and resolution meaning.

Confidence is a research aid, not proof. Exchange resolution rules can differ even when titles look identical. A human should verify both contracts before this project is ever used for trading.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm start` | Run at `http://localhost:3000` |
| `npm run dev` | Run and restart automatically after edits |
| `npm test` | Run the automated matcher tests |

## Project map

- `server.js` — local web server, exchange API adapters, caching, and optional AI review
- `matcher.js` — fast first-pass candidate scoring
- `public/` — dashboard HTML, CSS, and browser JavaScript
- `test/` — automated matcher tests

## Current limitations and next steps

- This is discovery, not a trading or arbitrage system.
- Public API availability and exchange fields can change.
- A production version should store reviewed links in a database, compare exact resolution rules and closing times, let a human approve/reject suggestions, and add price/spread tracking only after contract equivalence is verified.

# Market Twin

Market Twin continuously downloads **all open, priced markets** from **Polymarket** and **Kalshi**, finds likely equivalent contracts, and calculates both possible cross-exchange hedges. It is a research scanner—it does **not** place trades.

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

The market data used here is public, so **you do not need Polymarket or Kalshi keys** for this read-only scanner. The built-in matcher works without any key. An OpenAI key is optional and adds a stricter AI review pass to the strongest candidate pairs.

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

1. A background job paginates through the complete collection of currently open markets. Polymarket uses offset pages; Kalshi uses its returned cursor. Empty/unpriced markets and Kalshi multivariate parlays are excluded because they cannot produce an actionable two-contract hedge.
2. The scanner repeats every two minutes, even when nobody has the web page open. It retries transient API failures and preserves the last good collection if one exchange is temporarily unavailable.
3. An inverted token index finds candidates across thousands of contracts without attempting an extremely expensive comparison of every market with every other market. Titles, rules, dates, thresholds, names, and numbers contribute to confidence.
4. When `OPENAI_API_KEY` is present, the strongest 80 candidates receive a conservative AI review that checks the event, subject, threshold, direction, time window, and settlement meaning.
5. Both guaranteed-payout combinations are priced: **Kalshi YES + Polymarket NO** and **Kalshi NO + Polymarket YES**.

### Efficiency safeguards

- Polymarket pages are downloaded five at a time; Kalshi remains cursor-sequential because each page supplies the token required for the next one.
- IDs are deduplicated before matching, transient requests use bounded retries, and a scan cannot overlap another scan.
- The browser receives counts and matched pairs—not the tens of thousands of full source records held by the scanner.
- The dashboard renders at most 100 cards at once while category counts continue to cover the complete result set.
- Change `POLYMARKET_CONCURRENCY` in `.env` only if the API or hosting environment requires a lower request rate.

## The three price categories

Every equivalent binary pair has two opposite-outcome routes. Buying one contract on each side guarantees a gross $1 payout if—and only if—the contracts truly have identical settlement rules.

- **Over $1:** the cheapest pair of asks costs at least $1 before fees. This is a valid match, but not a buy-side arbitrage.
- **Under $1 · fees block:** the asks total less than $1, but estimated taker fees consume the discount.
- **Profitable:** asks plus estimated taker fees total less than $1. The displayed profit is `1 - asks - estimated fees` per paired contract.

The scanner uses executable ask prices rather than last-trade prices. Kalshi's standard taker estimate uses `0.07 × price × (1-price)` per contract; the implementation also accepts a market-specific fee multiplier when the public response provides one. For a conservative one-contract estimate, its trade fee is rounded to $0.0001 and the resulting non-direct-member cash debit is rounded to a cent, following Kalshi's documented [fee-rounding behavior](https://docs.kalshi.com/getting_started/fee_rounding). Polymarket fees are only applied when the market reports `feesEnabled`; its [official fee table](https://docs.polymarket.com/trading/fees) supplies the category rate applied to `price × (1-price)`. Exact fees can still include account-, series-, event-, maker/taker-, fill-, quantity-, and rounding-specific behavior, so figures remain estimates until an authenticated order preview is added.

Confidence is a research aid, not proof. Exchange resolution rules can differ even when titles look identical. A “profitable” label describes the price calculation, **not permission to trade**: a human must verify the contracts, available size, account eligibility, funding/withdrawal costs, and live order preview first.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm start` | Run at `http://localhost:3000` |
| `npm run dev` | Run and restart automatically after edits |
| `npm test` | Run the automated matcher tests |

## Project map

- `server.js` — local web server, paginated background scanner, API adapters, and optional AI review
- `matcher.js` — fast first-pass candidate scoring
- `public/` — dashboard HTML, CSS, and browser JavaScript
- `test/` — automated matcher tests

## Current limitations and next steps

- This is a continuously running discovery and price-estimation system, not an execution system.
- Public API availability and exchange fields can change.
- The scan is held in process memory; production persistence should be the next infrastructure step.
- A trading version must retrieve full order books and executable size, store human approvals, monitor settlement-rule changes, and request authenticated fee/order previews before execution.

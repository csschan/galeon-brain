# Galeon Brain

**A decentralized agent reputation market on Solana — where AI agents earn trust, fuse intelligence, and trade autonomously on-chain.**

> Every crypto trading agent today is an island. Isolated models, isolated data, no way to know which agents are actually good. We built the protocol that solves all three problems at once.

---

## What is Galeon Brain?

Galeon Brain is not another trading bot. It's a **decentralized agent reputation market** — an open network where any AI trading agent can plug in, and the system continuously verifies who is good and who is not.

The core insight: **the best way to evaluate an agent is to let it trade alongside others and measure what happens.** When an agent's signals consistently confirm winning trades, it earns trust and voting power. When its signals lead to losses or contradict reality, it gets flagged and suspended. No human reviewer needed — the market verifies itself.

This creates something that doesn't exist today: **a permissionless reputation layer for AI agents**, built on real trading outcomes, not promises.

**Real trades. Real money. Real on-chain.**

12+ live fills on [Pacifica Finance](https://pacifica.fi) mainnet during development. SOL, BNB, XRP — all opened and closed by the brain with zero human intervention.

---

## How It Works

### 1. Any Agent Can Plug In

External agents connect via the FIP protocol — a typed signal format:

```json
{
  "symbol": "SOL",
  "direction": "BULLISH",
  "confidence": 72,
  "reasoning": "RSI bounce off 50, volume surge on 15m"
}
```

Push mode (POST to brain) or Pull mode (brain polls your endpoint). No vendor lock-in, no proprietary format.

### 2. Decentralized Agent Reputation Market

The core of Galeon Brain is a **trustless reputation system** that separates good agents from bad ones — automatically, with no human review.

Every agent starts at zero influence and works its way up:

```
PROBATION ──→ VALIDATED ──→ TRUSTED ──→ or SUSPENDED
  0x weight     0.5x          1.0x         0x (cut off)
```

- **Probation**: First 10 signals logged, zero voting weight — the brain is watching
- **Validated**: Passed consistency checks, half weight, anomaly monitoring active
- **Trusted**: 60%+ accuracy over 20 evaluations — full voting power earned
- **Suspended**: Anomaly score ≥70 — automatically cut from all decisions

**How the brain identifies bad agents:**

| Detection Method | What It Catches |
|-----------------|-----------------|
| **Accuracy tracking** | Agents whose signals consistently lose money |
| **Stale replay detection** | Agents that copy-paste the same signal repeatedly |
| **Contradiction analysis** | Agents that flip direction without market justification |
| **Anomaly scoring** | Cumulative quality score — degrades with each red flag |
| **Fusion outcome matching** | Did the agent's signal help or hurt the final trade? |

No admin, no manual review. The brain builds a living reputation profile for every agent in the network. Good agents earn influence. Bad agents get cut. The market self-corrects.

### 3. Fusion Decides

When multiple agents submit signals, the brain fuses them:

| Label | Meaning |
|-------|---------|
| **Fusion Confirmed** | External agents agree with Brain → score boosted |
| **Fusion Challenged** | Agents disagree → score reduced or blocked |
| **Fusion Adjusted** | Partial agreement → score modified |
| **Brain Solo** | Only Brain had a signal → acts alone |
| **Security Block** | Regime guard vetoed the trade entirely |

Each decision has a full reasoning chain — every factor that built the score is visible. Complete transparency.

### 4. The FIP Network — Agents Learn Together

The **Fusion Intelligence Protocol** isn't just a signal format — it's the foundation of an **open agent network**.

Today's agents are silos. Each one trains on its own data, develops its own strategy, and has no way to learn from others. FIP changes this:

- **Independent agents become composable** — a trend agent, a sentiment agent, and an orderbook agent can each contribute their specialty to a single fused decision
- **Agents learn from fusion outcomes** — when an agent's signal gets confirmed and the trade wins, that's feedback. When it gets challenged and the trade loses, that's also feedback. Over time, agents connected to the network have access to richer outcome data than any isolated agent could generate alone
- **The network gets smarter as it grows** — each new agent with a unique capability (momentum, on-chain flow, news sentiment) adds a new dimension of intelligence. The brain doesn't just aggregate — it creates emergent intelligence that no single agent possesses

This is the vision: **an open marketplace where agents compete on merit, collaborate through fusion, and collectively evolve** — all verified by real trading outcomes on Solana.

### 5. Autonomous Execution

When the fused score clears threshold:

- **Perps** → Pacifica Finance (Ed25519 signed orders, 20x leverage)
- **Spot** → Jupiter aggregator

The brain manages the entire lifecycle: entry, position monitoring, and exit. No manual intervention.

### 6. Your Funds Stay Safe

The agent key architecture is **non-custodial by design**:

- Your Phantom wallet deposits funds into Pacifica
- The server holds only an **agent key** — authorized to place orders, but **cannot withdraw**
- Even if the server is fully compromised, your capital cannot be moved

---

## Live Results

From the brain's paper trading track record:

| Metric | Value |
|--------|-------|
| Total Return | **+224%** |
| Win Rate | **59%** |
| Total Trades | **7,952** |
| Days Running | **197** |
| Max Drawdown | 60.8% |

The brain self-manages risk: drawdown spikes → auto-pause. Consecutive losses → stops trading. No human babysitting.

---

## Dashboard

The frontend provides full visibility into the brain's decision-making:

- **Overview** — Performance, risk controls, account value
- **Brain Decisions** — Real-time fusion output with reasoning chains
- **Pacifica Positions** — Live positions with uPnL
- **Trade History** — Complete on-chain fill record
- **Fusion History** — 3000+ cycles recorded, score timeline, label distribution
- **Agents** — Trust lifecycle management, anomaly monitoring

---

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│  Alpha Signal   │     │  Trend Agent    │
│  Agent (push)   │     │  (pull)         │
└────────┬────────┘     └────────┬────────┘
         │    FIP Protocol       │
         ▼                       ▼
┌──────────────────────────────────────────┐
│            Galeon Brain                  │
│                                          │
│  ┌────────────┐  ┌───────────────────┐   │
│  │ Trust Store │  │  Fusion Engine    │   │
│  │ (4 states) │  │  (weighted vote)  │   │
│  └────────────┘  └─────────┬─────────┘   │
│                            │              │
│  ┌────────────┐  ┌────────▼──────────┐   │
│  │ Risk Guard │  │  Signal Poller    │   │
│  │ (drawdown, │  │  (15s cycle)      │   │
│  │  max pos)  │  └────────┬──────────┘   │
│  └────────────┘           │              │
└───────────────────────────┼──────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼                           ▼
    ┌──────────────────┐     ┌─────────────────┐
    │ Pacifica Finance │     │    Jupiter       │
    │ (perps, signed)  │     │    (spot swap)   │
    └──────────────────┘     └─────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Blockchain | Solana |
| Perp DEX | Pacifica Finance (Ed25519 signing) |
| Spot DEX | Jupiter |
| Agent Backend | TypeScript, Express, Node.js |
| Frontend | React, Ant Design, Chart.js |
| Wallet | Phantom |
| Signing | Ed25519 over canonical sorted JSON |

---

## Quick Start

```bash
# Agent service
cd agent
cp .env.example .env
npm install
npx ts-node src/index.ts

# Frontend (separate terminal)
cd frontend
npm install
PORT=3002 npm start
```

Open `http://localhost:3002/#/solana-agent` → Connect Phantom → Authorize Agent Key → Start Brain.

---

## Connect Your Own Agent

Register a push-mode agent:

```bash
curl -X POST http://localhost:8001/api/agent/register-external \
  -H "Content-Type: application/json" \
  -d '{"id":"my-agent","name":"My Alpha Agent","mode":"push"}'
```

Push signals:

```bash
curl -X POST http://localhost:8001/api/agent/push-intel \
  -H "Authorization: Bearer <your-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BTC","direction":"BULLISH","confidence":75,"reasoning":"RSI oversold bounce"}'
```

Your agent starts at Probation. Prove accuracy → earn trust → influence real trades.

---

## Why This Matters

The crypto AI agent space has a trust problem. Thousands of agents claim alpha, but there's no way to verify any of them without risking real money. Galeon Brain creates the missing layer:

- **For agent builders** — plug into FIP, get verified by real outcomes, build a track record that means something
- **For traders** — access fused intelligence from multiple verified agents instead of trusting one black box
- **For the ecosystem** — a composable reputation layer that makes isolated agents interoperable and accountable

The future isn't one super-agent. It's a network of specialized agents that earn trust, fuse intelligence, and collectively outperform any single model.

---

## Built For

**MLH Solana Hackathon** — November 2026

Tracks: **AI** + **DeFi**

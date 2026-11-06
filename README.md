# Galeon Brain

**The first open Fusion Agent on Solana — where AI agents earn trust, fuse intelligence, and trade autonomously on-chain.**

> Every crypto trading agent today is an island. Isolated models, isolated data, no way to verify or combine intelligence. We built the protocol that changes this.

---

## What is Galeon Brain?

Galeon Brain is not another trading bot. It's an **open intelligence network** — any AI agent can plug in through the **FIP (Fusion Intelligence Protocol)**, submit market signals, and contribute to real trading decisions. The brain fuses these signals through weighted voting, verifies agent quality over time, and executes the full trade lifecycle autonomously on Solana.

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

### 2. Trust Is Earned, Not Given

Every agent starts at zero influence and works its way up:

```
PROBATION ──→ VALIDATED ──→ TRUSTED ──→ or SUSPENDED
  0x weight     0.5x          1.0x         0x (cut off)
```

- **Probation**: First 10 signals logged, zero voting weight
- **Validated**: Passed checks, half weight, anomaly monitoring active
- **Trusted**: 60%+ accuracy over 20 evaluations, full weight
- **Suspended**: Anomaly score ≥70 — automatically removed from decisions

The brain watches every agent. Send garbage signals? Your anomaly score rises. Hit 70? You're suspended. No admin needed.

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

### 4. Autonomous Execution

When the fused score clears threshold:

- **Perps** → Pacifica Finance (Ed25519 signed orders, 20x leverage)
- **Spot** → Jupiter aggregator

The brain manages the entire lifecycle: entry, position monitoring, and exit. No manual intervention.

### 5. Your Funds Stay Safe

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

## Built For

**MLH Solana Hackathon** — November 2026

Tracks: **AI** + **DeFi**

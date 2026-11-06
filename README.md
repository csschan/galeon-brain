# Galeon Brain — Fusion Agent on Solana

An open-protocol AI trading agent that fuses intelligence from multiple external agents and executes autonomous on-chain trades via Pacifica Finance (perps) and Jupiter (spot).

## The Problem

Every crypto trading agent today is an island — isolated models, isolated data, no way to combine intelligence or verify each other.

## The Solution

Galeon Brain is an open Fusion Agent built on the **FIP (Fusion Intelligence Protocol)**. Any AI agent can plug in, submit typed signals (symbol, direction, confidence, reasoning), and the brain fuses them through weighted voting with a built-in trust lifecycle:

- **Probation** → zero weight, signals logged only
- **Validated** → 0.5x weight, anomaly monitoring active
- **Trusted** → full 1.0x weight (60%+ accuracy over 20 evals)
- **Suspended** → zero weight (anomaly score ≥70)

## Architecture

```
External Agents ──┐
                   ├─→ FIP Protocol ──→ Fusion Engine ──→ Pacifica Finance (perps)
Galeon Brain ──────┘         │                                Jupiter (spot)
                        Trust Store
                     Anomaly Detection
```

### Key Features

- **Fusion Intelligence Protocol (FIP)** — typed signal format for agent interoperability
- **Trust Lifecycle** — agents earn voting weight through proven accuracy
- **Anomaly Detection** — automatic suspension of malicious or degraded agents
- **Non-custodial Agent Key** — can trade on Pacifica but cannot withdraw funds
- **Full Trade Lifecycle** — autonomous open, monitor, and close
- **Risk Controls** — max positions, drawdown limits, consecutive loss pause

## Tech Stack

- **Blockchain**: Solana
- **Perp DEX**: Pacifica Finance (Ed25519 signed orders)
- **Spot DEX**: Jupiter
- **Agent Backend**: Node.js / TypeScript / Express
- **Frontend**: React / TypeScript / Ant Design
- **Wallet**: Phantom

## Project Structure

```
solana-hackathon/
├── agent/          # Backend agent service (port 8001)
│   ├── src/
│   │   ├── execution/    # Pacifica & Jupiter executors
│   │   ├── fusion/       # FIP engine, trust store, intel buffer
│   │   ├── keys/         # Solana key management
│   │   ├── risk/         # Risk checks
│   │   ├── routes/       # API routes
│   │   ├── signals/      # Signal poller
│   │   └── index.ts      # Entry point
│   └── data/             # Runtime state (gitignored)
├── frontend/       # React dashboard (port 3002)
│   └── src/
│       └── components/nearAgent/
│           ├── SolanaAgentSetup.tsx    # 3-step setup flow
│           └── AgentDashboard.tsx      # Full dashboard
└── contracts/      # Solana programs
```

## Setup

### Agent Service

```bash
cd agent
cp .env.example .env
# Edit .env with your config
npm install
npx ts-node src/index.ts
```

### Frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm start
```

### Connect

1. Open `http://localhost:3002/#/solana-agent`
2. Connect Phantom wallet
3. Authorize agent key (signs bind message on Pacifica)
4. Start Brain

## Built for

MLH Solana Hackathon — November 2026

Tracks: AI, DeFi

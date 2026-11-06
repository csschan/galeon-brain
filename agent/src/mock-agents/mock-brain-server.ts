/**
 * Mock Brain Server — Simulates Galeon AI Server for local hackathon demo
 *
 * Replaces the full MySQL-backed ai-server with a lightweight Express mock.
 * Returns realistic paper-trade positions and market overview data.
 *
 * Run: npx tsx src/mock-agents/mock-brain-server.ts
 * Default port: 8080
 *
 * Endpoints served:
 *   GET /api/paper-trade/positions   — Active signal positions (Brain assessments)
 *   GET /api/paper-trade/overview    — Market overview + BTC trend
 *   GET /api/brain-link/activity     — Recent activity feed
 */

import express from 'express';
import cors from 'cors';

const PORT = process.env.MOCK_BRAIN_PORT || 8080;

const app = express();
app.use(cors());
app.use(express.json());

// ─── Simulated market state ────────────────────────────────────────────────

interface MockPosition {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  confidence: number;
  entryPrice: number;
  leverage: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2?: number;
  entryReason: string;
  openTime: string;
}

function getPositions(): MockPosition[] {
  const now = new Date().toISOString();

  // Rotate positions slightly over time for realistic demo
  const minute = Math.floor(Date.now() / 60000);
  const phase = minute % 4;

  const base: MockPosition[] = [
    {
      symbol: 'SOL',
      direction: 'LONG',
      confidence: 72 + (phase * 2),
      entryPrice: 185.4,
      leverage: 3,
      stopLoss: 174.2,
      takeProfit1: 198.0,
      takeProfit2: 215.0,
      entryReason: 'EMA20>EMA50 bullish cross, OI_rising, low_funding_rate, volume_spike',
      openTime: now,
    },
    {
      symbol: 'ETH',
      direction: 'LONG',
      confidence: 65 + phase,
      entryPrice: 3420.0,
      leverage: 2,
      stopLoss: 3200.0,
      takeProfit1: 3650.0,
      takeProfit2: 3900.0,
      entryReason: 'Range_support_bounce, RSI_oversold_exit, OI_stable',
      openTime: now,
    },
    {
      symbol: 'WIF',
      direction: phase < 2 ? 'LONG' : 'SHORT',
      confidence: 58 + (phase * 3),
      entryPrice: 2.84,
      leverage: 2,
      stopLoss: phase < 2 ? 2.55 : 3.15,
      takeProfit1: phase < 2 ? 3.20 : 2.40,
      entryReason: phase < 2
        ? 'Meme_momentum, volume_acceleration, smart_money_accumulation'
        : 'Exhaustion_top, funding_rate_extreme, distribution_signal',
      openTime: now,
    },
    {
      symbol: 'BTC',
      direction: 'LONG',
      confidence: 70,
      entryPrice: 97800,
      leverage: 2,
      stopLoss: 92000,
      takeProfit1: 105000,
      takeProfit2: 115000,
      entryReason: 'Macro_bull_regime, institutional_flow, weekly_support_hold',
      openTime: now,
    },
  ];

  // Rotate which tokens are "active" for variety
  const activeCount = 2 + (phase % 3);
  return base.slice(0, activeCount);
}

function getBtcTrend(): string {
  const hour = new Date().getHours();
  // Cycle through regimes for demo
  if (hour % 4 === 0) return 'CAUTION';
  if (hour % 3 === 0) return 'DOWN';
  return 'UP';
}

// ─── Routes ───────────────────────────────────────────────────────────────

/**
 * GET /api/paper-trade/positions
 * Returns active paper-trade positions (Brain signal assessments)
 */
app.get('/api/paper-trade/positions', (req, res) => {
  const positions = getPositions();
  console.log(`[MockBrain] /positions → ${positions.length} positions (strategy=${req.query.strategy || 'stable'})`);
  res.json({
    success: true,
    data: positions,
  });
});

/**
 * GET /api/paper-trade/overview
 * Returns aggregated performance + BTC market regime
 */
app.get('/api/paper-trade/overview', (req, res) => {
  const btcTrend = getBtcTrend();
  console.log(`[MockBrain] /overview → btcTrend=${btcTrend}`);
  res.json({
    success: true,
    data: {
      btcTrend,
      totalReturn: 247.3,
      totalPnl: 2473.0,
      winRate: 0.603,
      totalTrades: 6082,
      winCount: 3669,
      lossCount: 2413,
      maxDrawdown: 12.4,
      daysRunning: 180,
      dailyPnl: 13.7,
      startCapital: 1000,
      capital: 3473,
      activePositions: getPositions().length,
      consecutiveLosses: 1,
      availableCapital: 847,
      paused: false,
      strategy: req.query.strategy || 'stable',
    },
  });
});

/**
 * GET /api/brain-link/activity
 * Returns recent activity feed for dashboard
 */
app.get('/api/brain-link/activity', (req, res) => {
  const positions = getPositions();
  const activities = positions.map((p, i) => ({
    id: `activity-${i}`,
    type: 'OPEN',
    symbol: p.symbol,
    direction: p.direction,
    confidence: p.confidence,
    entryPrice: p.entryPrice,
    leverage: p.leverage,
    entryReason: p.entryReason,
    timestamp: p.openTime,
  }));
  res.json({ success: true, activities });
});

/**
 * GET /api/health
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', mode: 'mock-brain', positions: getPositions().length });
});

app.listen(PORT, () => {
  console.log(`[MockBrain] Galeon Brain mock server running on port ${PORT}`);
  console.log(`[MockBrain] Endpoints:`);
  console.log(`  GET http://localhost:${PORT}/api/paper-trade/positions`);
  console.log(`  GET http://localhost:${PORT}/api/paper-trade/overview`);
  console.log(`[MockBrain] BTC trend: ${getBtcTrend()}`);
  console.log(`[MockBrain] Active positions: ${getPositions().length}`);
});

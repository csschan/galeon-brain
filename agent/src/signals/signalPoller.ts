/**
 * Signal Poller — Polls all registered sources via FusionEngine
 * Uses weighted-vote fusion, regime guard, and symbol guard before executing
 *
 * Execution routing:
 *   SOL / BTC / ETH → JupiterPerpsExecutor (leveraged long/short)
 *   Everything else → JupiterExecutor (spot swap)
 *
 * Note: Drift Protocol removed (paused Nov 2026).
 */

import { RiskCheck } from '../risk/riskCheck';
import { PacificaExecutor } from '../execution/pacificaExecutor';
import { JupiterExecutor } from '../execution/jupiterExecutor';
import { routeToken } from '../execution/tokenRouter';
import { ExecutionLog } from '../store/executionLog';
import { solanaWalletStore } from '../store/solanaWalletStore';
import { SolanaKeyManager } from '../keys/solanaKeyManager';
import { FusionEngine } from '../fusion/fusionEngine';
import * as fs from 'fs';
import * as path from 'path';

const COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours cooldown after executing a signal
const COOLDOWN_FILE = path.join(process.cwd(), '.signal-cooldowns.json');

function loadCooldowns(): Map<string, number> {
  try {
    if (fs.existsSync(COOLDOWN_FILE)) {
      const data = JSON.parse(fs.readFileSync(COOLDOWN_FILE, 'utf-8'));
      return new Map(Object.entries(data).map(([k, v]) => [k, Number(v)]));
    }
  } catch {}
  return new Map();
}

function saveCooldowns(map: Map<string, number>) {
  try {
    fs.writeFileSync(COOLDOWN_FILE, JSON.stringify(Object.fromEntries(map)));
  } catch {}
}

const POLL_INTERVAL_MS = 15_000; // 15 seconds

export interface Signal {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  confidence: number;
  leverage: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2?: number;
  timestamp: string;
  entryReason?: string;
}

export class SignalPoller {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private knownSignalIds = new Set<string>();
  private cooldowns: Map<string, number> = loadCooldowns();

  constructor(
    private riskCheck: RiskCheck,
    private pacifica: PacificaExecutor,
    private jupiterExecutor: JupiterExecutor,
    private keyManager: SolanaKeyManager,
    private executionLog: ExecutionLog,
    private fusionEngine: FusionEngine,
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  start(walletAddress: string): void {
    if (this.running) return;
    this.running = true;
    const strategy = solanaWalletStore.getStrategy(walletAddress) || process.env.AI_SERVER_STRATEGY || 'stable';
    console.log(`[SignalPoller] Started for ${walletAddress.slice(0, 8)}..., strategy=${strategy}`);

    this.timer = setInterval(() => this.poll(walletAddress), POLL_INTERVAL_MS);
    this.poll(walletAddress);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[SignalPoller] Stopped');
  }

  private async poll(walletAddress: string): Promise<void> {
    try {
      const strategy = solanaWalletStore.getStrategy(walletAddress) || process.env.AI_SERVER_STRATEGY || 'stable';
      const decisions = await this.fusionEngine.evaluateMarket(strategy);

      for (const decision of decisions) {
        // Only execute LONG/SHORT — WAIT/REDUCE/CLOSE are logged only
        if (decision.action === 'WAIT' || decision.action === 'REDUCE' || decision.action === 'CLOSE') {
          const lastReason = decision.reasoning[decision.reasoning.length - 1];
          console.log(`[SignalPoller] ${decision.symbol} ${decision.action} (${decision.label}) score=${decision.score}: ${lastReason?.detail || ''}`);
          continue;
        }

        // Stable ID: symbol+action only — prevents re-executing within the same session
        const signalId = `brain-${decision.symbol}-${decision.action}`;
        if (this.knownSignalIds.has(signalId)) continue;

        // Cooldown check — don't re-execute within 4 hours of last execution
        const lastExecuted = this.cooldowns.get(signalId) || 0;
        if (Date.now() - lastExecuted < COOLDOWN_MS) {
          const minsLeft = Math.ceil((COOLDOWN_MS - (Date.now() - lastExecuted)) / 60000);
          console.log(`[SignalPoller] ${decision.symbol} in cooldown — ${minsLeft}min remaining`);
          this.knownSignalIds.add(signalId);
          continue;
        }

        // Cross-check Pacifica live positions — skip if already open on exchange
        const mainAccount = this.keyManager.getMainAccount(walletAddress);
        if (mainAccount) {
          try {
            const livePositions = await this.pacifica.getPositions(mainAccount);
            const alreadyOpen = livePositions.some((p: any) =>
              (p.symbol || '').toUpperCase() === decision.symbol.toUpperCase() &&
              parseFloat(p.amount || p.size || '0') !== 0
            );
            if (alreadyOpen) {
              this.knownSignalIds.add(signalId);
              console.log(`[SignalPoller] ${decision.symbol} already open on Pacifica — skip`);
              continue;
            }
          } catch {}
        }

        this.knownSignalIds.add(signalId);

        const route = routeToken(decision.symbol);
        const contributors = decision.externalContributors.length > 0
          ? ` intel=[${decision.externalContributors.join(',')}]`
          : '';
        console.log(`[SignalPoller] ${decision.label}: ${decision.symbol} ${decision.action} score=${decision.score} brain=${decision.brainContributed}${contributors} → ${route.route}`);

        const signal: Signal = {
          id: signalId,
          symbol: decision.symbol,
          direction: decision.action as 'LONG' | 'SHORT',
          entryPrice: decision.entryPrice || 0,
          confidence: decision.score,
          leverage: decision.leverage || 3,
          stopLoss: decision.stopLoss || 0,
          takeProfit1: decision.takeProfit1 || 0,
          takeProfit2: decision.takeProfit2,
          timestamp: decision.timestamp,
          entryReason: decision.reasoning.map(r => `${r.step}:${r.impact >= 0 ? '+' : ''}${r.impact}`).join(' '),
        };

        await this.processSignal(walletAddress, signal);
      }
    } catch (err: any) {
      if (err.code !== 'ECONNREFUSED') {
        console.error('[SignalPoller] Poll error:', err.message);
      }
    }
  }

  private async processSignal(walletAddress: string, signal: Signal): Promise<void> {
    const riskResult = this.riskCheck.check(walletAddress, signal, this.executionLog);
    if (!riskResult.allowed) {
      console.log(`[SignalPoller] Risk check rejected: ${riskResult.reason}`);
      this.executionLog.add({
        accountId: walletAddress,
        type: 'OPEN',
        symbol: signal.symbol,
        direction: signal.direction,
        amount: '0',
        status: 'FAILED',
        error: `Risk check: ${riskResult.reason}`,
      });
      return;
    }

    const route = routeToken(signal.symbol);

    try {
      const keypair = this.keyManager.getKeypair(walletAddress);
      const mainAccount = this.keyManager.getMainAccount(walletAddress);
      const tradeAmount = Number(process.env.TRADE_AMOUNT_USDC || '10');

      if (route.route === 'PACIFICA_PERP') {
        // Leveraged perp trade on Pacifica Finance
        const result = await this.pacifica.executeSignal(keypair, signal.symbol, signal.direction, tradeAmount, mainAccount);
        if (result.status === 'FAILED') throw new Error(result.error || 'Pacifica order failed');
        // Save cooldown so we don't re-execute this signal for 4 hours
        const cid = `brain-${signal.symbol}-${signal.direction}`;
        this.cooldowns.set(cid, Date.now());
        saveCooldowns(this.cooldowns);
        console.log(`[SignalPoller] Pacifica perp executed: ${signal.symbol} ${signal.direction} orderId=${result.orderId}`);
      } else {
        // Spot swap on Jupiter for all other tokens
        const result = await this.jupiterExecutor.executeSignal(keypair, signal.symbol, signal.direction, tradeAmount);
        if (result.status === 'FAILED') throw new Error(result.error || 'Jupiter spot swap failed');
        console.log(`[SignalPoller] Jupiter spot executed: ${signal.symbol} ${signal.direction} tx=${result.txSignature}`);
      }

      this.executionLog.add({
        accountId: walletAddress,
        type: 'OPEN',
        symbol: signal.symbol,
        direction: signal.direction,
        amount: `${riskResult.tradeAmount} USDC`,
        status: 'SUCCESS',
        note: route.note,
      } as any);
    } catch (err: any) {
      console.error(`[SignalPoller] Execution failed for ${signal.symbol}:`, err.message);
      this.executionLog.add({
        accountId: walletAddress,
        type: 'OPEN',
        symbol: signal.symbol,
        direction: signal.direction,
        amount: '0',
        status: 'FAILED',
        error: err.message,
      });
    }
  }
}

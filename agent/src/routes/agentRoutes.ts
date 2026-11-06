/**
 * Agent API Routes — Exposes agent status, executions, key management to frontend
 */

import { Router } from 'express';
import { SolanaKeyManager } from '../keys/solanaKeyManager';
import { ExecutionLog } from '../store/executionLog';
import { SignalPoller } from '../signals/signalPoller';
import { solanaWalletStore } from '../store/solanaWalletStore';
import { SourceStore } from '../fusion/sourceStore';
import { FusionEngine } from '../fusion/fusionEngine';
import { IntelBuffer } from '../fusion/intelBuffer';
import { adaptLegacySignal } from '../fusion/legacyAdapter';
import { AgentIntelligence } from '../fusion/fip-types';
import { parseTextIntelligence, analyzeReasoning, isDeepSeekAvailable } from '../services/deepseekService';
import * as crypto from 'crypto';

function normalizeSymbol(raw: string): string {
  return raw.replace(/USDT$|PERP$|-PERP$|USD$/, '').replace(/\/.*/, '').toUpperCase();
}

const BRAIN_AUTH = { headers: { Authorization: 'Bearer galeon-agent' } };

export function agentRoutes(
  keyManager: SolanaKeyManager,
  executionLog: ExecutionLog,
  signalPoller: SignalPoller,
  sourceStore: SourceStore,
  fusionEngine: FusionEngine,
  pacificaExecutor?: import('../execution/pacificaExecutor').PacificaExecutor,
): Router {
  const router = Router();

  /**
   * POST /api/agent/register-wallet
   * Frontend sends Solana keypair (agent delegated wallet) after user approval
   * Body: { walletAddress, secretKey (base58), strategy? }
   */
  router.post('/register-wallet', async (req, res) => {
    try {
      const { walletAddress, secretKey, strategy, mainAccount } = req.body;
      if (!walletAddress || !secretKey) {
        return res.status(400).json({ error: 'Missing walletAddress or secretKey' });
      }

      keyManager.registerWallet(walletAddress, secretKey, strategy || 'stable', mainAccount);
      solanaWalletStore.set(walletAddress, strategy || 'stable');

      signalPoller.start(walletAddress);

      res.json({ success: true, message: `Agent registered for ${walletAddress}`, agentWallet: walletAddress, mainAccount });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/agent/bind-agent-wallet
   * Forward the Phantom-signed bind request to Pacifica to authorize the agent key.
   * Body: { account, agent_wallet, signature, timestamp, expiry_window, type }
   * (all pre-signed by Phantom on the frontend)
   */
  router.post('/bind-agent-wallet', async (req, res) => {
    if (!pacificaExecutor) return res.status(503).json({ error: 'Pacifica executor not available' });
    try {
      const result = await pacificaExecutor.bindAgentWallet(req.body);
      if (result.success) {
        res.json({ success: true, message: 'Agent wallet bound to Pacifica account' });
      } else {
        // If already bound, treat as success
        const errMsg = (result.error || '').toLowerCase();
        if (errMsg.includes('already') || errMsg.includes('exists') || errMsg.includes('bound')) {
          res.json({ success: true, message: 'Agent key already authorized' });
        } else {
          res.status(400).json({ success: false, error: result.error });
        }
      }
    } catch (err: any) {
      const errMsg = (err.message || '').toLowerCase();
      if (errMsg.includes('already') || errMsg.includes('exists') || errMsg.includes('bound')) {
        res.json({ success: true, message: 'Agent key already authorized' });
      } else {
        res.status(500).json({ error: err.message });
      }
    }
  });

  /**
   * POST /api/agent/revoke-wallet
   * Stop agent and remove keypair
   */
  router.post('/revoke-wallet', async (req, res) => {
    try {
      const { walletAddress } = req.body;
      if (!walletAddress) {
        return res.status(400).json({ error: 'Missing walletAddress' });
      }

      signalPoller.stop();
      keyManager.revokeWallet(walletAddress);

      res.json({ success: true, message: `Agent revoked for ${walletAddress}` });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/agent/status/:walletAddress
   * Dashboard polls this for real-time agent state
   */
  router.get('/status/:walletAddress', async (req, res) => {
    const { walletAddress } = req.params;
    const hasWallet = keyManager.hasWallet(walletAddress);
    const walletInfo = keyManager.getWalletInfo(walletAddress);
    const stats = executionLog.getStats(walletAddress);
    const strategy = solanaWalletStore.getStrategy(walletAddress);

    res.json({
      running: hasWallet && signalPoller.isRunning(),
      strategy,
      walletAddress,
      walletInfo,
      activePositions: stats.activePositions,
      totalTrades: stats.totalTrades,
      totalPnl: stats.totalPnl,
    });
  });

  /**
   * GET /api/agent/executions/:accountId
   * Execution log for dashboard table
   */
  router.get('/executions/:accountId', (req, res) => {
    const { accountId } = req.params;
    const limit = parseInt(req.query.limit as string) || 20;
    const executions = executionLog.getByAccount(accountId, limit);
    res.json({ executions });
  });

  /**
   * GET /api/agent/positions/:accountId
   * Active positions from execution log
   */
  router.get('/positions/:accountId', (req, res) => {
    const { accountId } = req.params;
    const positions = executionLog.getActivePositions(accountId);
    res.json({ positions });
  });

  /**
   * GET /api/agent/signals
   * Current signals from ai-server (for Dashboard display)
   */
  router.get('/signals', async (req, res) => {
    try {
      const axios = (await import('axios')).default;
      const AI_SERVER_URL = process.env.AI_SERVER_URL || 'http://localhost:8080/api';
      const strategy = (req.query.strategy as string) || 'stable';
      const result = await axios.get(`${AI_SERVER_URL}/paper-trade/positions`, {
        params: { strategy },
        timeout: 8000,
        ...BRAIN_AUTH,
      });
      res.json({ success: true, signals: result.data.data || [] });
    } catch (err: any) {
      res.json({ success: false, signals: [], error: err.message });
    }
  });

  /**
   * GET /api/agent/pacifica-fills/:agentWallet
   * Returns Pacifica trade history (fills/orders) for the mainAccount
   */
  router.get('/pacifica-fills/:agentWallet', async (req, res) => {
    const { agentWallet } = req.params;
    const mainAccount = keyManager.getMainAccount(agentWallet) || agentWallet;
    try {
      const axios = (await import('axios')).default;
      const PACIFICA_API = process.env.PACIFICA_API_URL || 'https://api.pacifica.fi/api/v1';
      const r = await axios.get(`${PACIFICA_API}/orders/history`, {
        params: { account: mainAccount, limit: 50 },
        timeout: 8000,
      });
      const fills = r.data?.data || r.data?.orders || r.data || [];
      res.json({ success: true, fills, mainAccount });
    } catch (err: any) {
      res.json({ success: false, fills: [], error: err.message });
    }
  });

  /**
   * GET /api/agent/pacifica-account/:agentWallet
   * Returns Pacifica account balance and positions for the mainAccount linked to this agent wallet
   */
  router.get('/pacifica-account/:agentWallet', async (req, res) => {
    const { agentWallet } = req.params;
    const mainAccount = keyManager.getMainAccount(agentWallet) || agentWallet;
    try {
      const axios = (await import('axios')).default;
      const PACIFICA_API = process.env.PACIFICA_API_URL || 'https://api.pacifica.fi/api/v1';
      const [accountRes, posRes] = await Promise.allSettled([
        axios.get(`${PACIFICA_API}/account`, { params: { account: mainAccount }, timeout: 8000 }),
        axios.get(`${PACIFICA_API}/positions`, { params: { account: mainAccount }, timeout: 8000 }),
      ]);
      const accountRaw = accountRes.status === 'fulfilled' ? accountRes.value.data : null;
      const accountData = accountRaw?.data || accountRaw;
      const positions = posRes.status === 'fulfilled' ? (posRes.value.data?.data || posRes.value.data?.positions || posRes.value.data || []) : [];
      const accountValue = accountData?.account_equity || accountData?.balance || accountData?.account_value || 0;
      const equity = parseFloat(accountValue) || 0;

      // Enrich positions with mark price, uPnl, and leverage
      let markPrices: Record<string, number> = {};
      try {
        const mkRes = await axios.get(`${PACIFICA_API}/markets`, { timeout: 5000 });
        const markets = mkRes.data?.markets || mkRes.data || [];
        for (const m of (Array.isArray(markets) ? markets : [])) {
          const sym = (m.symbol || m.name || '').toUpperCase();
          const price = parseFloat(m.mark_price || m.last_price || m.price || '0');
          if (sym && price) markPrices[sym] = price;
        }
      } catch { /* use Binance fallback below */ }

      const enriched = await Promise.all(positions.map(async (p: any) => {
        const sym = (p.symbol || '').toUpperCase();
        const size = parseFloat(p.amount || '0');
        const entryPrice = parseFloat(p.entry_price || '0');
        let markPrice = markPrices[sym];
        if (!markPrice) {
          try {
            const bRes = await axios.get(`https://api.binance.com/api/v3/ticker/price`, { params: { symbol: `${sym}USDT` }, timeout: 3000 });
            markPrice = parseFloat(bRes.data?.price || '0');
          } catch { markPrice = entryPrice; }
        }
        const posValue = size * markPrice;
        const uPnl = p.side === 'bid' ? (markPrice - entryPrice) * size : (entryPrice - markPrice) * size;
        const leverage = 20; // Pacifica cross margin default
        return { ...p, mark_price: markPrice, unrealized_pnl: uPnl, position_value: posValue, leverage: Math.round(leverage * 10) / 10 };
      }));

      res.json({
        success: true,
        mainAccount,
        accountValue: equity,
        positions: enriched,
        raw: accountData,
      });
    } catch (err: any) {
      res.json({ success: false, mainAccount, accountValue: 0, positions: [], error: err.message });
    }
  });

  /**
   * GET /api/agent/pacifica-positions/:walletAddress
   * Live Pacifica perp positions
   */
  router.get('/pacifica-positions/:walletAddress', async (req, res) => {
    const { walletAddress } = req.params;
    try {
      const axios = (await import('axios')).default;
      const PACIFICA_API = process.env.PACIFICA_API_URL || 'https://api.pacifica.fi/api/v1';
      const r = await axios.get(`${PACIFICA_API}/positions`, { params: { account: walletAddress }, timeout: 8000 });
      const livePositions = r.data?.positions || r.data || [];
      const logPositions = executionLog.getActivePositions(walletAddress);
      res.json({ positions: livePositions, logPositions, walletAddress });
    } catch (err: any) {
      const logPositions = executionLog.getActivePositions(walletAddress);
      res.json({ positions: [], logPositions, walletAddress, error: err.message });
    }
  });

  // Legacy alias
  router.get('/drift-positions/:walletAddress', async (req, res) => {
    res.redirect(`/api/agent/pacifica-positions/${req.params.walletAddress}`);
  });

  /**
   * GET /api/agent/brain-status
   * Brain running state + market regime from ai-server
   */
  router.get('/brain-status', async (req, res) => {
    try {
      const axios = (await import('axios')).default;
      const AI_SERVER_URL = process.env.AI_SERVER_URL || 'http://localhost:8080/api';
      const accountId = req.query.accountId as string;
      const strategy = (accountId && solanaWalletStore.getStrategy(accountId))
        || (req.query.strategy as string)
        || 'stable';
      const result = await axios.get(`${AI_SERVER_URL}/paper-trade/overview`, {
        params: { strategy },
        timeout: 8000,
        ...BRAIN_AUTH,
      });
      const data = result.data.data || {};
      const trendMap: Record<string, string> = {
        UP: 'UP', BULL: 'UP', BULLISH: 'UP',
        DOWN: 'DOWN', BEAR: 'DOWN', BEARISH: 'DOWN',
        NEUTRAL: 'NEUTRAL', SIDEWAYS: 'NEUTRAL', RANGE: 'NEUTRAL',
        CAUTION: 'CAUTION', CAUTION_BEAR: 'CAUTION', CAUTION_BULL: 'CAUTION',
      };
      const rawTrend = (data.btcTrend || '').toUpperCase();
      const marketRegime = trendMap[rawTrend] || 'UNKNOWN';
      res.json({
        success: true,
        running: signalPoller.isRunning(),
        marketRegime,
        paused: data.paused || false,
        activePositions: data.activePositions || 0,
        strategy,
      });
    } catch (err: any) {
      res.json({
        success: false,
        running: signalPoller.isRunning(),
        marketRegime: 'UNKNOWN',
        error: err.message,
      });
    }
  });

  /**
   * GET /api/agent/performance
   * PnL, win rate, drawdown from ai-server
   */
  router.get('/performance', async (req, res) => {
    try {
      const axios = (await import('axios')).default;
      const AI_SERVER_URL = process.env.AI_SERVER_URL || 'http://localhost:8080/api';
      const accountId = req.query.accountId as string;
      const strategy = (accountId && solanaWalletStore.getStrategy(accountId))
        || (req.query.strategy as string)
        || 'stable';
      const result = await axios.get(`${AI_SERVER_URL}/paper-trade/overview`, {
        params: { strategy },
        timeout: 8000,
        ...BRAIN_AUTH,
      });
      const data = result.data.data || {};
      res.json({
        success: true,
        totalReturn: data.totalReturn || 0,
        totalPnl: data.totalPnl || 0,
        winRate: data.winRate || 0,
        totalTrades: data.totalTrades || 0,
        winCount: data.winCount || 0,
        lossCount: data.lossCount || 0,
        maxDrawdown: data.maxDrawdown || 0,
        daysRunning: data.daysRunning || 0,
        dailyPnl: data.dailyPnl || 0,
        startCapital: data.startCapital || 0,
        capital: data.capital || 0,
      });
    } catch (err: any) {
      res.json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/agent/risk-status
   * Risk state: consecutive losses, drawdown level, paused
   */
  router.get('/risk-status', async (req, res) => {
    try {
      const axios = (await import('axios')).default;
      const AI_SERVER_URL = process.env.AI_SERVER_URL || 'http://localhost:8080/api';
      const accountId = req.query.accountId as string;
      const strategy = (accountId && solanaWalletStore.getStrategy(accountId))
        || (req.query.strategy as string)
        || 'stable';
      const result = await axios.get(`${AI_SERVER_URL}/paper-trade/overview`, {
        params: { strategy },
        timeout: 8000,
        ...BRAIN_AUTH,
      });
      const data = result.data.data || {};
      const maxDrawdown = data.maxDrawdown || 0;
      const riskLevel = maxDrawdown > 30 ? 'HIGH' : maxDrawdown > 15 ? 'MEDIUM' : 'LOW';
      res.json({
        success: true,
        riskLevel,
        consecutiveLosses: data.consecutiveLosses || 0,
        maxDrawdown,
        paused: data.paused || false,
        availableCapital: data.availableCapital || 0,
      });
    } catch (err: any) {
      res.json({ success: false, error: err.message, riskLevel: 'UNKNOWN' });
    }
  });

  /**
   * GET /api/agent/brain-decisions
   * Active positions with decision reasoning + activity feed
   */
  router.get('/brain-decisions', async (req, res) => {
    try {
      const axios = (await import('axios')).default;
      const AI_SERVER_URL = process.env.AI_SERVER_URL || 'http://localhost:8080/api';
      const accountId = req.query.accountId as string;
      const strategy = (accountId && solanaWalletStore.getStrategy(accountId))
        || (req.query.strategy as string)
        || 'stable';

      // Try requested strategy, fall back to stable if server doesn't support it
      const posPromise = axios.get(`${AI_SERVER_URL}/paper-trade/positions`, { params: { strategy }, timeout: 8000, ...BRAIN_AUTH })
        .catch(async (e: any) => {
          if (e.response?.status === 404 && strategy !== 'stable') {
            return axios.get(`${AI_SERVER_URL}/paper-trade/positions`, { params: { strategy: 'stable' }, timeout: 8000, ...BRAIN_AUTH });
          }
          throw e;
        });

      const [posRes, actRes] = await Promise.allSettled([
        posPromise,
        axios.get(`${AI_SERVER_URL}/brain-link/activity`, { timeout: 8000, ...BRAIN_AUTH }),
      ]);

      const positions = posRes.status === 'fulfilled' ? (posRes.value.data?.data || []) : [];
      const activities = actRes.status === 'fulfilled' ? (actRes.value.data?.activities || []) : [];

      res.json({ success: true, positions, activities });
    } catch (err: any) {
      res.json({ success: false, positions: [], activities: [], error: err.message });
    }
  });

  /**
   * GET /api/agent/sources
   * List all registered external signal sources with trust stats
   */
  router.get('/sources', (req, res) => {
    const ts = fusionEngine.getTrustStore();
    const sources = sourceStore.getAll().map(s => {
      const trust = ts?.getReport(s.id);
      return {
        id: s.id,
        name: s.name,
        url: s.url,
        trustWeight: s.trustWeight,
        totalSignals: s.totalSignals,
        wonSignals: s.wonSignals,
        lostSignals: s.lostSignals,
        winRate: s.totalSignals > 0 ? parseFloat((s.wonSignals / s.totalSignals).toFixed(3)) : null,
        active: s.active,
        registeredAt: s.registeredAt,
        capabilities: s.capabilities,
        // Trust system fields
        trustState: trust?.state || (s.id === 'galeon-brain' ? 'TRUSTED' : 'PROBATION'),
        trustMultiplier: trust?.trustMultiplier ?? (s.id === 'galeon-brain' ? 1.0 : 0.0),
        anomalyScore: trust?.anomalyScore ?? 0,
        anomalyCount: trust?.anomalies.length ?? 0,
        // Suspension detail
        suspensionReason: trust?.state === 'SUSPENDED'
          ? trust.stateHistory.filter(h => h.state === 'SUSPENDED').pop()?.reason || 'Anomaly threshold exceeded'
          : undefined,
        // Top anomaly types for display
        topAnomalies: trust?.anomalies
          ? Object.entries(
              trust.anomalies.reduce((acc: Record<string, number>, a) => { acc[a.type] = (acc[a.type] || 0) + 1; return acc; }, {})
            ).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([type, count]) => ({ type, count }))
          : [],
      };
    });
    res.json({ success: true, sources });
  });

  /**
   * POST /api/agent/register-external
   * Register an external agent as a signal source.
   *
   * Two modes:
   *   mode='pull' (default): Brain pulls from agent URL. Agent must be publicly reachable.
   *   mode='push': Agent pushes intel TO Brain. No URL needed. Returns a pushApiKey.
   *
   * Body: { id, name, url?, apiKey?, capabilities?, protocolType?, mode? }
   */
  router.post('/register-external', async (req, res) => {
    try {
      const { id, name, url, apiKey, capabilities, protocolType, mode } = req.body;
      if (!id || !name) {
        return res.status(400).json({ error: 'Missing id or name' });
      }
      if (id === 'galeon-brain') {
        return res.status(400).json({ error: 'Reserved source id' });
      }

      // ══════════════════════════════════════════════════════════════════════
      // PUSH MODE — Agent will POST intel to Brain. No URL validation needed.
      // ══════════════════════════════════════════════════════════════════════
      if (mode === 'push') {
        const pushApiKey = `gal_${crypto.randomBytes(24).toString('hex')}`;
        const source = sourceStore.register(
          id, name, '', undefined,
          capabilities || ['GENERAL'],
          'push',
        );
        // Push agents start inactive — user must enable after wiring up the API key
        const src = sourceStore.get(id);
        if (src) {
          src.pushApiKey = pushApiKey;
          src.active = false;
        }
        // Force save
        (sourceStore as any).save?.();

        console.log(`[agentRoutes] Push agent registered: ${id} (key: ${pushApiKey.slice(0, 12)}...)`);
        return res.json({
          success: true,
          mode: 'push',
          source,
          pushApiKey,
          pushEndpoint: '/api/agent/push-intel',
          example: {
            curl: `curl -X POST ${req.protocol}://${req.get('host')}/api/agent/push-intel \\
  -H "Authorization: Bearer ${pushApiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"symbol":"BTC","direction":"BULLISH","confidence":75,"reasoning":"RSI oversold bounce"}'`,
            python: `import requests\nrequests.post("${req.protocol}://${req.get('host')}/api/agent/push-intel",\n  headers={"Authorization": "Bearer ${pushApiKey}"},\n  json={"symbol": "BTC", "direction": "BULLISH", "confidence": 75})`,
          },
        });
      }

      // ══════════════════════════════════════════════════════════════════════
      // PULL MODE (default) — Brain will poll agent URL
      // ══════════════════════════════════════════════════════════════════════
      if (!url) {
        return res.status(400).json({ error: 'Missing url (required for pull mode). Use mode="push" for push-based agents.' });
      }
      try { new URL(url); } catch {
        return res.status(400).json({ error: 'Invalid url' });
      }

      const axios = (await import('axios')).default;
      const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

      let validProtocol: 'fip' | 'legacy' | null = null;
      let detectedCapabilities: string[] = [];

      // Try FIP protocol first (GET /intel)
      try {
        const fipRes = await axios.get(`${url}/intel`, { headers, timeout: 6000 });
        if (fipRes.data?.intel && Array.isArray(fipRes.data.intel) && fipRes.data.intel.length > 0) {
          const first = fipRes.data.intel[0];
          if (first.data?.capability || first.symbol) {
            validProtocol = 'fip';
            detectedCapabilities = [...new Set<string>(fipRes.data.intel.map((i: any) => i.data?.capability).filter(Boolean))];
          }
        }
      } catch { /* FIP not available */ }

      // Try legacy protocol (GET /positions)
      if (!validProtocol) {
        try {
          const legacyRes = await axios.get(`${url}/positions`, { headers, timeout: 6000 });
          if (legacyRes.data?.success && Array.isArray(legacyRes.data?.data)) {
            validProtocol = 'legacy';
            const reasons = (legacyRes.data.data || []).map((s: any) => s.entryReason || '').join(' ');
            if (reasons.includes('EMA') || reasons.includes('RSI')) detectedCapabilities.push('TREND_ANALYSIS');
            if (reasons.includes('taker') || reasons.includes('FR')) detectedCapabilities.push('ORDERBOOK_DEPTH');
            if (detectedCapabilities.length === 0) detectedCapabilities.push('GENERAL');
          }
        } catch { /* also failed */ }
      }

      if (!validProtocol) {
        return res.status(400).json({
          error: 'Agent unreachable or invalid response. Must expose GET /intel (FIP) or GET /positions (legacy). Or use mode="push" to push intel to Brain.',
        });
      }

      const source = sourceStore.register(
        id, name, url, apiKey,
        capabilities || detectedCapabilities,
        protocolType || validProtocol,
      );
      console.log(`[agentRoutes] Pull agent registered: ${id} → ${url} (protocol: ${validProtocol}, capabilities: ${detectedCapabilities.join(',')})`);
      res.json({ success: true, mode: 'pull', source, detectedProtocol: validProtocol, detectedCapabilities });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/agent/push-intel
   * External agents push intelligence directly to Brain.
   * Auth: Authorization: Bearer <pushApiKey>
   *
   * Body (text mode):  { symbol, text: "free-form market analysis" }
   * Body (simple):     { symbol, direction, confidence, reasoning? }
   * Body (FIP full):   { symbol, data: { capability, ... }, timeframe?, expiresAt? }
   * Body (batch):      { intel: [ ... array of above ... ] }
   *
   * If DeepSeek is configured:
   *   - text mode → LLM parses into structured intel
   *   - reasoning field → LLM scores quality, result used in Fusion weighting
   */
  router.post('/push-intel', async (req, res) => {
    // ── Auth: lookup agent by push API key ──
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing Authorization: Bearer <pushApiKey>' });
    }
    const pushKey = authHeader.slice(7).trim();
    const source = sourceStore.getByPushKey(pushKey);
    if (!source) {
      return res.status(403).json({ error: 'Invalid push API key' });
    }
    if (!source.active) {
      return res.status(403).json({ error: 'Agent is disabled' });
    }

    const body = req.body;
    const items: any[] = Array.isArray(body.intel) ? body.intel : [body];
    const results: { symbol: string; accepted: boolean; reason?: string; llmUsed?: string }[] = [];

    for (const raw of items) {
      try {
        const symbol = normalizeSymbol(raw.symbol || '');
        if (!symbol) { results.push({ symbol: '?', accepted: false, reason: 'Missing symbol' }); continue; }

        let intel: AgentIntelligence;
        let llmUsed: string | undefined;

        if (raw.text && !raw.direction && !raw.data?.capability) {
          // ── TEXT MODE: free-form market analysis → DeepSeek parsing ──
          if (!isDeepSeekAvailable()) {
            results.push({ symbol, accepted: false, reason: 'Text mode requires DEEPSEEK_API_KEY to be configured' });
            continue;
          }
          const parsed = await parseTextIntelligence(raw.text, symbol);
          llmUsed = 'deepseek:parse';
          intel = {
            agentId: source.id,
            agentName: source.name,
            symbol,
            data: {
              capability: 'GENERAL' as const,
              direction: parsed.direction,
              confidence: parsed.confidence,
              reasoning: parsed.reasoning,
              reasoningStrength: 0.7, // LLM-parsed text gets baseline strength; will be refined below
              reasoningFactors: parsed.keyFactors,
            },
            timeframe: raw.timeframe || '15m',
            timestamp: new Date().toISOString(),
            expiresAt: raw.expiresAt || IntelBuffer.defaultExpiry(),
          };
          // Analyze the LLM-generated reasoning for additional scoring
          if (parsed.reasoning && isDeepSeekAvailable()) {
            try {
              const analysis = await analyzeReasoning(parsed.reasoning, parsed.direction, symbol);
              (intel.data as any).reasoningStrength = Math.max(0.5, analysis.reasoningStrength); // text-parsed intel gets min 0.5
              if (analysis.factors.length) (intel.data as any).reasoningFactors = analysis.factors;
              llmUsed = 'deepseek:parse+analyze';
            } catch { /* keep baseline strength */ }
          }

        } else if (raw.data?.capability) {
          // ── FULL FIP FORMAT ──
          intel = {
            agentId: source.id,
            agentName: source.name,
            symbol,
            data: raw.data,
            timeframe: raw.timeframe || '15m',
            timestamp: raw.timestamp || new Date().toISOString(),
            expiresAt: raw.expiresAt || IntelBuffer.defaultExpiry(),
          };

        } else {
          // ── SIMPLE FORMAT → GeneralIntelligence ──
          const direction = (raw.direction || '').toUpperCase();
          const validDir = ['BULLISH', 'BEARISH', 'NEUTRAL', 'LONG', 'SHORT'].includes(direction);
          const mappedDir = direction === 'LONG' ? 'BULLISH' : direction === 'SHORT' ? 'BEARISH' : direction;
          const reasoning: string | undefined = raw.reasoning || raw.reason || raw.entryReason || undefined;

          intel = {
            agentId: source.id,
            agentName: source.name,
            symbol,
            data: {
              capability: 'GENERAL' as const,
              direction: (validDir ? mappedDir : 'NEUTRAL') as 'BULLISH' | 'BEARISH' | 'NEUTRAL',
              confidence: Math.max(0, Math.min(100, Number(raw.confidence) || 50)),
              reasoning,
            },
            timeframe: raw.timeframe || '15m',
            timestamp: raw.timestamp || new Date().toISOString(),
            expiresAt: raw.expiresAt || IntelBuffer.defaultExpiry(),
          };

          // ── Reasoning analysis via DeepSeek ──
          // If reasoning is provided, score its quality and inject into GeneralIntelligence
          if (reasoning && isDeepSeekAvailable()) {
            try {
              const analysis = await analyzeReasoning(reasoning, mappedDir || direction, symbol);
              (intel.data as any).reasoningStrength = analysis.reasoningStrength;
              if (analysis.factors.length) (intel.data as any).reasoningFactors = analysis.factors;
              llmUsed = 'deepseek:analyze';
            } catch (err: any) {
              console.warn(`[push-intel] Reasoning analysis failed for ${source.id}/${symbol}:`, err.message);
            }
          }
        }

        // Run through validation + trust
        const accepted = fusionEngine.validateAndSubmitPublic(source.id, intel);
        results.push({
          symbol,
          accepted,
          reason: accepted ? undefined : 'Failed validation (check trust report)',
          llmUsed,
        });
      } catch (err: any) {
        results.push({ symbol: raw.symbol || '?', accepted: false, reason: err.message });
      }
    }

    const acceptedCount = results.filter(r => r.accepted).length;
    console.log(`[push-intel] ${source.id}: ${acceptedCount}/${results.length} accepted`);
    res.json({
      success: true,
      agentId: source.id,
      received: results.length,
      accepted: acceptedCount,
      deepseekEnabled: isDeepSeekAvailable(),
      results,
    });
  });

  /**
   * PATCH /api/agent/sources/:id/toggle
   * Enable or disable a signal source (plug/unplug)
   */
  router.patch('/sources/:id/toggle', (req, res) => {
    const { id } = req.params;
    if (id === 'galeon-brain') {
      return res.status(400).json({ error: 'Cannot disable primary Brain agent' });
    }
    const source = sourceStore.getAll().find(s => s.id === id);
    if (!source) return res.status(404).json({ error: 'Source not found' });
    const newActive = !source.active;
    sourceStore.setActive(id, newActive);
    console.log(`[agentRoutes] Source ${id} toggled → ${newActive ? 'ON' : 'OFF'}`);
    res.json({ success: true, id, active: newActive });
  });

  /**
   * DELETE /api/agent/sources/:id
   * Remove an external signal source
   */
  router.delete('/sources/:id', (req, res) => {
    const { id } = req.params;
    if (id === 'galeon-brain') {
      return res.status(400).json({ error: 'Cannot remove primary Brain source' });
    }
    sourceStore.remove(id);
    res.json({ success: true });
  });

  /**
   * GET /api/agent/market-decisions
   * Brain-centric unified decisions with full reasoning chains.
   * This is the primary API for Brain Decisions UI.
   */
  router.get('/market-decisions', async (req, res) => {
    try {
      const accountId = req.query.accountId as string;
      const strategy = (accountId && solanaWalletStore.getStrategy(accountId))
        || (req.query.strategy as string)
        || 'stable';

      const decisions = await fusionEngine.evaluateMarket(strategy);
      const intelBuffer = fusionEngine.getIntelBuffer();

      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        decisions,
        intelSummary: {
          totalEntries: intelBuffer.size,
          activeSymbols: intelBuffer.getActiveSymbols(),
          agents: sourceStore.getActive()
            .filter(s => s.id !== 'galeon-brain')
            .map(s => ({
              id: s.id, name: s.name,
              capabilities: s.capabilities || ['GENERAL'],
              protocolType: s.protocolType || 'legacy',
              trustWeight: s.trustWeight,
              active: s.active,
            })),
        },
      });
    } catch (err: any) {
      res.json({ success: false, error: err.message, decisions: [] });
    }
  });

  /**
   * GET /api/agent/fusion-live
   * Backward-compatible view. Wraps market-decisions in old format.
   */
  router.get('/fusion-live', async (req, res) => {
    try {
      const axios = (await import('axios')).default;
      const sources = sourceStore.getActive();
      const strategy = (req.query.strategy as string) || 'stable';

      // 1. Fetch raw signals from each source in parallel (for display)
      const rawResults: {
        sourceId: string; sourceName: string; trustWeight: number;
        signals: any[]; error?: string; latencyMs: number;
      }[] = [];

      await Promise.allSettled(sources.map(async (src) => {
        const t0 = Date.now();

        // Push agents have no URL — they POST to Brain, Brain doesn't pull from them.
        // Show them as active in the list but skip pull attempt.
        if (src.protocolType === 'push') {
          const intelBuffer = fusionEngine.getIntelBuffer();
          const activeSymbols = intelBuffer.getActiveSymbols();
          const pushSignals = activeSymbols.flatMap(sym => {
            return intelBuffer.getForSymbol(sym)
              .filter(i => i.agentId === src.id)
              .map(i => ({
                symbol: sym,
                direction: (i.data as any).direction,
                confidence: (i.data as any).confidence,
                capability: i.data.capability,
              }));
          });
          rawResults.push({
            sourceId: src.id, sourceName: src.name, trustWeight: src.trustWeight,
            signals: pushSignals,
            latencyMs: 0,
            ...(pushSignals.length === 0 ? { error: 'Push agent — awaiting intel via POST /push-intel' } : {}),
          });
          return;
        }

        // galeon-brain is fetched inside evaluateMarket() — skip duplicate pull here,
        // just report its status from the decisions result after evaluation.
        if (src.id === 'galeon-brain') return;

        try {
          const url = `${src.url}/positions`;
          const headers: Record<string, string> = src.apiKey ? { Authorization: `Bearer ${src.apiKey}` } : {};
          const r = await axios.get(url, { headers, timeout: 8000 });
          const data = r.data?.data || r.data?.signals || [];
          rawResults.push({
            sourceId: src.id, sourceName: src.name, trustWeight: src.trustWeight,
            signals: Array.isArray(data) ? data : [],
            latencyMs: Date.now() - t0,
          });
        } catch (err: any) {
          rawResults.push({
            sourceId: src.id, sourceName: src.name, trustWeight: src.trustWeight,
            signals: [], error: err.message,
            latencyMs: Date.now() - t0,
          });
        }
      })); // end pull sources loop

      // 2. Run evaluation (galeon-brain fetch happens inside here)
      const decisions = await fusionEngine.evaluateMarket(strategy);

      // Inject galeon-brain summary into rawSignals from decision results
      const brainSrc = sourceStore.get('galeon-brain');
      if (brainSrc) {
        const brainSymbols = decisions.filter(d => d.brainContributed).map(d => d.symbol);
        rawResults.unshift({
          sourceId: 'galeon-brain',
          sourceName: brainSrc.name,
          trustWeight: brainSrc.trustWeight,
          signals: brainSymbols.map(sym => {
          const dec = decisions.find(d => d.symbol === sym);
          return {
            symbol: sym,
            source: 'galeon-brain',
            direction: dec?.action === 'LONG' ? 'BULLISH' : dec?.action === 'SHORT' ? 'BEARISH' : 'NEUTRAL',
            confidence: dec?.score,
          };
        }),
          latencyMs: 0,
          ...(brainSymbols.length === 0 ? { error: 'No active positions — using market baseline' } : {}),
        });
      }

      // 3. Map to old fusionResults format + add new decisions field
      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        rawSignals: rawResults,
        // New: full decision data with reasoning
        decisions,
        // Legacy compat
        fusionResults: decisions.map(d => ({
          symbol: d.symbol,
          direction: d.action === 'LONG' || d.action === 'SHORT' ? d.action : null,
          fusedScore: d.score,
          accepted: d.action === 'LONG' || d.action === 'SHORT',
          sources: [d.brainContributed ? 'galeon-brain' : '', ...d.externalContributors].filter(Boolean),
          bonuses: d.reasoning.filter(r => r.impact > 0 && r.step !== 'brain_assessment').map(r => `${r.step}+${r.impact}`),
          rejectionReason: d.action === 'WAIT' ? d.reasoning[d.reasoning.length - 1]?.detail : null,
          scenario: d.label,
          signal: (d.action === 'LONG' || d.action === 'SHORT') ? {
            id: `fused-${d.symbol}-${d.action}-${d.timestamp}`,
            symbol: d.symbol,
            direction: d.action,
            entryPrice: d.entryPrice,
            confidence: d.score,
            leverage: d.leverage,
            stopLoss: d.stopLoss,
            takeProfit1: d.takeProfit1,
          } : null,
        })),
      });
    } catch (err: any) {
      res.json({ success: false, error: err.message, rawSignals: [], fusionResults: [], decisions: [] });
    }
  });

  /**
   * GET /api/agent/trust-report
   * All agents' trust profiles — lifecycle state, anomaly score, accuracy
   */
  router.get('/trust-report', (req, res) => {
    const ts = fusionEngine.getTrustStore();
    if (!ts) return res.json({ success: false, error: 'Trust system not enabled' });
    const reports = ts.getAllReports();
    res.json({ success: true, agents: reports });
  });

  /**
   * GET /api/agent/trust-report/:agentId
   * Single agent trust detail
   */
  router.get('/trust-report/:agentId', (req, res) => {
    const ts = fusionEngine.getTrustStore();
    if (!ts) return res.json({ success: false, error: 'Trust system not enabled' });
    const report = ts.getReport(req.params.agentId);
    res.json({ success: true, report });
  });

  /**
   * POST /api/agent/trust/:agentId/unsuspend
   * Admin: reset suspended agent to PROBATION
   */
  router.post('/trust/:agentId/unsuspend', (req, res) => {
    const ts = fusionEngine.getTrustStore();
    if (!ts) return res.json({ success: false, error: 'Trust system not enabled' });
    ts.unsuspend(req.params.agentId);
    res.json({ success: true, state: 'PROBATION' });
  });

  /**
   * GET /api/agent/fusion-history
   * Returns paginated fusion decision history snapshots.
   * Query params:
   *   limit=60         — number of snapshots (default 60)
   *   symbol=BTC       — filter for symbol score trend
   *   mode=timeline    — returns compact score timeline for chart
   *   symbols=BTC,ETH  — multi-symbol score timeline
   */
  router.get('/fusion-history', (req, res) => {
    const hs = fusionEngine.historyStore;
    const limit = Math.min(parseInt(req.query.limit as string) || 500, 10000);
    const symbol = req.query.symbol as string | undefined;
    const mode = req.query.mode as string | undefined;
    const symbolsParam = req.query.symbols as string | undefined;

    if (mode === 'timeline' && symbolsParam) {
      const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).slice(0, 6);
      return res.json({
        success: true,
        mode: 'timeline',
        timeline: hs.getScoreTimeline(symbols, limit),
        symbols,
      });
    }

    if (symbol) {
      return res.json({
        success: true,
        mode: 'symbol',
        symbol: symbol.toUpperCase(),
        points: hs.getSymbolHistory(symbol.toUpperCase(), limit),
      });
    }

    const history = hs.getHistory(limit);
    const labelDist = hs.getLabelDistribution();
    const knownSymbols = hs.getKnownSymbols();

    res.json({
      success: true,
      mode: 'snapshots',
      totalSnapshots: hs.size,
      labelDistribution: labelDist,
      knownSymbols,
      snapshots: history,
    });
  });

  /**
   * POST /api/agent/test-trade
   * Manually trigger a Pacifica perp trade for testing
   * Body: { symbol, direction, amount? }
   */
  router.post('/test-trade', async (req, res) => {
    if (!pacificaExecutor) return res.status(503).json({ error: 'Pacifica executor not available' });
    const { symbol = 'BTC', direction = 'LONG', amount = 10 } = req.body;
    const wallets = keyManager.getRegisteredWallets();
    if (wallets.length === 0) return res.status(400).json({ error: 'No wallet registered' });
    try {
      const keypair = keyManager.getKeypair(wallets[0]);
      const mainAccount = keyManager.getMainAccount(wallets[0]);
      const result = await pacificaExecutor.executeSignal(keypair, symbol, direction, Number(amount), mainAccount);
      executionLog.add({
        accountId: wallets[0],
        type: 'OPEN',
        symbol,
        direction,
        amount: `${amount} USDC`,
        status: result.status,
        error: result.error,
      } as any);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

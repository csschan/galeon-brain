/**
 * Galeon Solana Agent Service
 * - Polls all registered signal sources via FusionEngine
 * - Fuses signals with weighted voting + regime guard
 * - Executes trades via Pacifica Finance (perp) or Jupiter (spot)
 * - Exposes status/execution/source API for frontend dashboard
 */

import 'dotenv/config';
import * as https from 'https';
import * as tls from 'tls';
import express from 'express';
import cors from 'cors';
import { SignalPoller } from './signals/signalPoller';
import { PacificaExecutor } from './execution/pacificaExecutor';
import { JupiterExecutor } from './execution/jupiterExecutor';
import { SolanaKeyManager } from './keys/solanaKeyManager';
import { ExecutionLog } from './store/executionLog';
import { RiskCheck } from './risk/riskCheck';
import { SourceStore } from './fusion/sourceStore';
import { FusionEngine } from './fusion/fusionEngine';
import { IntelBuffer } from './fusion/intelBuffer';
import { TrustStore } from './fusion/trustStore';
import { SignalValidator } from './fusion/signalValidator';
import { agentRoutes } from './routes/agentRoutes';


const PORT = process.env.PORT || 3001;

const app = express();
// Private Network Access header MUST be set before cors() handles OPTIONS preflight.
// Chrome 94+ requires Access-Control-Allow-Private-Network: true for cross-port localhost requests.
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  next();
});
app.use(cors({ origin: true, credentials: false }));
app.use(express.json());

// Core services
const keyManager = new SolanaKeyManager();
const executionLog = new ExecutionLog();
const riskCheck = new RiskCheck();
const pacifica = new PacificaExecutor();
const jupiterExecutor = new JupiterExecutor(executionLog);
const sourceStore = new SourceStore();
const intelBuffer = new IntelBuffer();
const trustStore = new TrustStore();
const signalValidator = new SignalValidator();
const fusionEngine = new FusionEngine(sourceStore, intelBuffer, trustStore, signalValidator);

// Auto-trust built-in Brain
trustStore.setTrusted('galeon-brain');
const signalPoller = new SignalPoller(riskCheck, pacifica, jupiterExecutor, keyManager, executionLog, fusionEngine);

// API routes
app.use('/api/agent', agentRoutes(keyManager, executionLog, signalPoller, sourceStore, fusionEngine, pacifica));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    running: signalPoller.isRunning(),
    wallets: keyManager.getRegisteredWallets().length,
    sources: sourceStore.getActive().length,
  });
});

app.listen(PORT, () => {
  console.log(`[Agent] Galeon Solana Agent running on port ${PORT}`);
  console.log(`[Agent] Signal source: ${process.env.AI_SERVER_URL || 'http://localhost:8080/api'}`);
  console.log(`[Agent] Solana RPC: ${process.env.SOLANA_RPC_URL || 'mainnet-beta (default)'}`);
  console.log(`[Agent] Active signal sources: ${sourceStore.getActive().length}`);

  // Auto-resume polling for any wallets restored from disk
  const wallets = keyManager.getRegisteredWallets();
  if (wallets.length > 0) {
    console.log(`[Agent] Resuming signal polling for ${wallets.length} wallet(s)`);
    signalPoller.start(wallets[0]);
  }
});

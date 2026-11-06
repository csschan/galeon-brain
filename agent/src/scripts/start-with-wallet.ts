/**
 * start-with-wallet.ts
 * Reads AGENT_WALLET_SECRET_KEY + AGENT_WALLET_ADDRESS from .env,
 * registers the wallet with the agent, and starts signal polling.
 *
 * Run after the main agent is already up:
 *   npx tsx src/scripts/start-with-wallet.ts
 */

import 'dotenv/config';
import axios from 'axios';

const AGENT_URL = `http://localhost:${process.env.PORT || 6000}`;
const SECRET_KEY = process.env.AGENT_WALLET_SECRET_KEY;
const WALLET_ADDRESS = process.env.AGENT_WALLET_ADDRESS;
const STRATEGY = process.env.AI_SERVER_STRATEGY || 'stable';

async function main() {
  if (!SECRET_KEY || SECRET_KEY === 'YOUR_PRIVATE_KEY_HERE') {
    console.error('[setup] ERROR: Set AGENT_WALLET_SECRET_KEY in .env first');
    process.exit(1);
  }
  if (!WALLET_ADDRESS || WALLET_ADDRESS === 'YOUR_WALLET_ADDRESS_HERE') {
    console.error('[setup] ERROR: Set AGENT_WALLET_ADDRESS in .env first');
    process.exit(1);
  }

  console.log(`[setup] Registering wallet ${WALLET_ADDRESS.slice(0, 8)}... with agent`);

  try {
    const res = await axios.post(`${AGENT_URL}/api/agent/register-wallet`, {
      walletAddress: WALLET_ADDRESS,
      secretKey: SECRET_KEY,
      strategy: STRATEGY,
    });

    if (res.data.success) {
      console.log(`[setup] Wallet registered. Signal polling started.`);
      console.log(`[setup] Strategy: ${STRATEGY}`);
      console.log(`[setup] Trade size: $${process.env.TRADE_AMOUNT_USDC || 10} USDC per signal`);
      console.log(`[setup] Watch logs at: http://localhost:${process.env.PORT || 3001}/health`);
    } else {
      console.error('[setup] Registration failed:', res.data);
    }
  } catch (err: any) {
    console.error('[setup] Error:', err.message);
    console.error('[setup] Is the agent running? Start it first with: npm start');
  }
}

main();

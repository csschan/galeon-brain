/**
 * Jupiter Executor — Executes spot swaps via Jupiter Aggregator v6 API
 *
 * Used for tokens NOT listed on Drift perp markets.
 * Galeon Brain still provides directional signals; execution is spot.
 *
 * LONG signal  → swap USDC → token
 * SHORT signal → swap token → USDC (requires holding the token)
 *
 * Jupiter API v6: https://quote-api.jup.ag/v6
 */

import axios from 'axios';
import {
  Connection,
  Keypair,
  VersionedTransaction,
  PublicKey,
} from '@solana/web3.js';
import { ExecutionLog } from '../store/executionLog';

const JUP_API = 'https://quote-api.jup.ag/v6';
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// USDC on Solana mainnet
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Token mint registry — highest-volume token per symbol from dexscreener
const TOKEN_MINTS: Record<string, string> = {
  'SOL':    'So11111111111111111111111111111111111111112',
  'JUP':    'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  'WIF':    'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  'BONK':   'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  'BOME':   'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82',
  'POPCAT': '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
  'MOODENG':'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzc8yy',
  'STRK':   'CkkrN2XnCRaRTt75MaKE6LcGDCNVYuCAZ2eTMfBLeBTe',
  // AI server signal tokens (looked up via dexscreener by volume)
  'VVV':    'TayhzorYRyNaXxGAM6MgG4K2c3bEQQ1BL8cK2RtheZ7',
  'RAYSOL': 'LAinEtNLgpmCP9Rvsf5Hn8W6EhNiKLZMTlkokBZu9HB',
};

export interface JupiterSwapResult {
  status: 'SUCCESS' | 'FAILED';
  inputMint: string;
  outputMint: string;
  inputAmount: number;
  outputAmount: number;
  txSignature?: string;
  error?: string;
}

export class JupiterExecutor {
  private connection: Connection;

  constructor(private executionLog: ExecutionLog) {
    this.connection = new Connection(RPC_URL, 'confirmed');
  }

  /**
   * Execute a spot swap based on Brain signal direction
   * LONG  → buy token with USDC
   * SHORT → sell token for USDC (only if holding)
   */
  async executeSignal(
    keypair: Keypair,
    symbol: string,
    direction: 'LONG' | 'SHORT',
    usdcAmount: number,
  ): Promise<JupiterSwapResult> {
    let tokenMint = this.getTokenMint(symbol);
    if (!tokenMint) {
      // Try dynamic lookup from Jupiter
      tokenMint = await this.lookupTokenMint(symbol);
    }
    if (!tokenMint) {
      return {
        status: 'FAILED',
        inputMint: '',
        outputMint: '',
        inputAmount: 0,
        outputAmount: 0,
        error: `No mint address found for ${symbol}. Not listed on Jupiter token list.`,
      };
    }

    const amountRaw = Math.round(usdcAmount * 1e6); // USDC has 6 decimals

    if (direction === 'LONG') {
      // USDC → token
      return this.swap(keypair, USDC_MINT, tokenMint, amountRaw, symbol, direction);
    } else {
      // token → USDC (need to know how much token we hold)
      const tokenBalance = await this.getTokenBalance(keypair.publicKey, tokenMint);
      if (tokenBalance <= 0) {
        console.log(`[JupiterExecutor] No ${symbol} balance to sell for SHORT signal`);
        return {
          status: 'FAILED',
          inputMint: tokenMint,
          outputMint: USDC_MINT,
          inputAmount: 0,
          outputAmount: 0,
          error: `No ${symbol} balance to sell`,
        };
      }
      return this.swap(keypair, tokenMint, USDC_MINT, tokenBalance, symbol, direction);
    }
  }

  /**
   * Execute a Jupiter swap: inputMint → outputMint
   */
  private async swap(
    keypair: Keypair,
    inputMint: string,
    outputMint: string,
    amount: number,
    symbol: string,
    direction: string,
  ): Promise<JupiterSwapResult> {
    // 1. Get quote
    const quoteRes = await axios.get(`${JUP_API}/quote`, {
      params: {
        inputMint,
        outputMint,
        amount,
        slippageBps: 50, // 0.5% slippage
        onlyDirectRoutes: false,
      },
    });

    const quote = quoteRes.data;
    console.log(`[JupiterExecutor] Quote: ${amount / 1e6} → ${quote.outAmount / 1e6} (${symbol} ${direction})`);

    // 2. Get swap transaction
    const swapRes = await axios.post(`${JUP_API}/swap`, {
      quoteResponse: quote,
      userPublicKey: keypair.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    });

    // 3. Deserialize and sign
    const swapTx = VersionedTransaction.deserialize(
      Buffer.from(swapRes.data.swapTransaction, 'base64'),
    );
    swapTx.sign([keypair]);

    // 4. Send and confirm
    const txSig = await this.connection.sendRawTransaction(swapTx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });

    await this.connection.confirmTransaction(txSig, 'confirmed');
    console.log(`[JupiterExecutor] Swap confirmed: ${txSig}`);

    return {
      status: 'SUCCESS',
      inputMint,
      outputMint,
      inputAmount: amount,
      outputAmount: Number(quote.outAmount),
      txSignature: txSig,
    };
  }

  /**
   * Get SPL token balance in raw units
   */
  private async getTokenBalance(wallet: PublicKey, mint: string): Promise<number> {
    try {
      const mintPubkey = new PublicKey(mint);
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(wallet, {
        mint: mintPubkey,
      });
      if (tokenAccounts.value.length === 0) return 0;
      const amount = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.amount;
      return Number(amount);
    } catch {
      return 0;
    }
  }

  private getTokenMint(symbol: string): string | null {
    const normalized = symbol.replace(/USDT$|PERP$|-PERP$|USD$/, '').toUpperCase();
    return TOKEN_MINTS[normalized] || null;
  }

  /**
   * Dynamically look up a token mint from Jupiter token search API.
   * Returns the highest-liquidity match for the symbol.
   */
  async lookupTokenMint(symbol: string): Promise<string | null> {
    const normalized = symbol.replace(/USDT$|PERP$|-PERP$|USD$/, '').toUpperCase();
    // Check cache first
    if (TOKEN_MINTS[normalized]) return TOKEN_MINTS[normalized];
    try {
      // Jupiter token search
      const res = await axios.get(`https://api.jup.ag/tokens/v1/search`, {
        params: { query: normalized, limit: 5 },
        timeout: 5000,
      });
      const tokens: any[] = res.data?.tokens || res.data || [];
      // Find exact symbol match with highest 24h volume
      const match = tokens
        .filter((t: any) => t.symbol?.toUpperCase() === normalized)
        .sort((a: any, b: any) => (b.daily_volume || 0) - (a.daily_volume || 0))[0];
      if (match?.address) {
        TOKEN_MINTS[normalized] = match.address;
        console.log(`[JupiterExecutor] Resolved ${normalized} → ${match.address} (vol: ${match.daily_volume})`);
        return match.address;
      }
    } catch (err: any) {
      console.warn(`[JupiterExecutor] Token lookup failed for ${normalized}:`, err.message);
    }
    return null;
  }

  registerTokenMint(symbol: string, mint: string): void {
    TOKEN_MINTS[symbol.toUpperCase()] = mint;
    console.log(`[JupiterExecutor] Registered mint ${mint} for ${symbol}`);
  }
}

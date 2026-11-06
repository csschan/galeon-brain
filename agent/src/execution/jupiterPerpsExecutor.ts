/**
 * Jupiter Perps Executor — Leveraged perp trades on Jupiter Perpetuals
 *
 * Jupiter Perpetuals is Solana's largest on-chain perp DEX.
 * Supported markets: SOL, BTC, ETH
 * Max leverage: 100x (we use conservative 2x for safety)
 *
 * API: https://perps-api.jup.ag/v1
 * Docs: https://station.jup.ag/docs/perpetuals/jupiter-perpetuals-contract
 */

import axios from 'axios';
import { Connection, Keypair, VersionedTransaction, PublicKey } from '@solana/web3.js';
import { ExecutionLog } from '../store/executionLog';

const JUP_PERPS_API = 'https://perps-api.jup.ag/v1';
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://rpc.ankr.com/solana';

// Jupiter Perps supported markets (custody addresses)
const JUP_PERP_MARKETS: Record<string, { custody: string; collateralCustody: string }> = {
  'SOL': {
    custody: 'So11111111111111111111111111111111111111112',
    collateralCustody: 'So11111111111111111111111111111111111111112',
  },
  'BTC': {
    custody: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',
    collateralCustody: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',
  },
  'ETH': {
    custody: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
    collateralCustody: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
  },
};

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export interface JupiterPerpsResult {
  status: 'SUCCESS' | 'FAILED';
  symbol: string;
  direction: 'LONG' | 'SHORT';
  collateral: number;
  leverage: number;
  txSignature?: string;
  positionKey?: string;
  error?: string;
}

export class JupiterPerpsExecutor {
  private connection: Connection;

  constructor(private executionLog: ExecutionLog) {
    this.connection = new Connection(RPC_URL, 'confirmed');
  }

  supportsSymbol(symbol: string): boolean {
    return symbol.toUpperCase() in JUP_PERP_MARKETS;
  }

  getSupportedSymbols(): string[] {
    return Object.keys(JUP_PERP_MARKETS);
  }

  async executeSignal(
    keypair: Keypair,
    symbol: string,
    direction: 'LONG' | 'SHORT',
    usdcAmount: number,
  ): Promise<JupiterPerpsResult> {
    const normalized = symbol.toUpperCase();
    if (!this.supportsSymbol(normalized)) {
      return { status: 'FAILED', symbol, direction, collateral: 0, leverage: 0, error: `${symbol} not supported by Jupiter Perps` };
    }

    const leverage = Number(process.env.PERP_LEVERAGE || '2');
    console.log(`[JupiterPerps] ${normalized} ${direction} $${usdcAmount} x${leverage}`);

    try {
      // 1. Get open position transaction from Jupiter Perps API
      const openRes = await axios.post(`${JUP_PERPS_API}/openPosition`, {
        wallet: keypair.publicKey.toBase58(),
        market: normalized,
        side: direction.toLowerCase(), // 'long' | 'short'
        collateralUsd: usdcAmount,
        leverage,
        collateralMint: USDC_MINT,
        // slippage in bps
        slippageBps: 100,
      }, { timeout: 15000 });

      const { transaction: txBase64, positionKey } = openRes.data;
      if (!txBase64) throw new Error('No transaction returned from Jupiter Perps API');

      // 2. Deserialize, sign, send
      const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, 'base64'));
      tx.sign([keypair]);

      const txSig = await this.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
      await this.connection.confirmTransaction(txSig, 'confirmed');

      console.log(`[JupiterPerps] Position opened: ${normalized} ${direction} tx=${txSig}`);
      return {
        status: 'SUCCESS',
        symbol: normalized,
        direction,
        collateral: usdcAmount,
        leverage,
        txSignature: txSig,
        positionKey,
      };
    } catch (err: any) {
      // If Jupiter Perps API fails, fall back gracefully with clear error
      const msg = err.response?.data?.message || err.response?.data?.error || err.message;
      console.error(`[JupiterPerps] Failed for ${normalized}:`, msg);
      return { status: 'FAILED', symbol: normalized, direction, collateral: usdcAmount, leverage, error: msg };
    }
  }

  async closePosition(keypair: Keypair, symbol: string, positionKey: string): Promise<JupiterPerpsResult> {
    const normalized = symbol.toUpperCase();
    try {
      const closeRes = await axios.post(`${JUP_PERPS_API}/closePosition`, {
        wallet: keypair.publicKey.toBase58(),
        positionKey,
        collateralMint: USDC_MINT,
        slippageBps: 100,
      }, { timeout: 15000 });

      const { transaction: txBase64 } = closeRes.data;
      const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, 'base64'));
      tx.sign([keypair]);

      const txSig = await this.connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
      await this.connection.confirmTransaction(txSig, 'confirmed');

      console.log(`[JupiterPerps] Position closed: ${normalized} tx=${txSig}`);
      return { status: 'SUCCESS', symbol: normalized, direction: 'LONG', collateral: 0, leverage: 0, txSignature: txSig };
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message;
      return { status: 'FAILED', symbol: normalized, direction: 'LONG', collateral: 0, leverage: 0, error: msg };
    }
  }

  async getPositions(walletAddress: string): Promise<any[]> {
    try {
      const res = await axios.get(`${JUP_PERPS_API}/positions`, {
        params: { walletAddress },
        timeout: 8000,
      });
      return res.data?.positions || res.data || [];
    } catch {
      return [];
    }
  }
}

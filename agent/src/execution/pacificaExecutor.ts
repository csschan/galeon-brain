/**
 * Pacifica Finance Executor — Leveraged perp trades on Pacifica (Solana)
 *
 * Pacifica is a multi-asset perp DEX on Solana supporting:
 *   - Crypto: BTC(50x), ETH(50x), SOL(20x), WIF/BONK/STRK(5-10x), 50+ others
 *   - Equities: NVDA, TSLA, MSTR, GOOGL, etc. (10x)
 *   - FX: EURUSD, USDJPY (50x)
 *   - Commodities: XAU, XAG, CL, NATGAS (10x)
 *
 * Auth: Ed25519 signature over alphabetically-sorted compact JSON payload
 * API: https://api.pacifica.fi/api/v1
 * Docs: https://docs.pacifica.fi
 */

import axios from 'axios';
import { Keypair } from '@solana/web3.js';
import * as nacl from 'tweetnacl';
import bs58 from 'bs58';
import { v4 as uuidv4 } from 'uuid';

const PACIFICA_API = process.env.PACIFICA_API_URL || 'https://api.pacifica.fi/api/v1';
const BUILDER_CODE = process.env.PACIFICA_BUILDER_CODE || '';

// All Pacifica perp markets with max leverage
const PACIFICA_MARKETS: Record<string, number> = {
  // Crypto — high liquidity
  'BTC': 50, 'ETH': 50,
  'SOL': 20, 'BNB': 20, 'DOGE': 20, 'HYPE': 20, 'XRP': 20,
  'AAVE': 10, 'ADA': 10, 'ARB': 10, 'AVAX': 10, 'BCH': 10,
  'CRV': 10, 'ENA': 10, 'JUP': 10, 'LDO': 10, 'LINK': 10,
  'LTC': 10, 'NEAR': 10, 'SUI': 10, 'TAO': 10, 'TRUMP': 10,
  'UNI': 10, 'FARTCOIN': 10, 'PUMP': 10, 'kBONK': 10, 'kPEPE': 10,
  'ICP': 5, 'PENGU': 5, 'STRK': 5, 'VIRTUAL': 5, 'WIF': 5,
  'WLD': 5, 'ZK': 5, 'ZRO': 5,
  // Equities
  'NVDA': 10, 'TSLA': 10, 'MSTR': 10, 'GOOGL': 10, 'HOOD': 10,
  'PLTR': 10, 'CRCL': 10,
  // Commodities
  'XAU': 10, 'XAG': 10, 'CL': 10, 'NATGAS': 10, 'COPPER': 10,
  // Indices
  'SP500': 20,
  // FX
  'EURUSD': 50, 'USDJPY': 50,
};

export interface PacificaOrderResult {
  status: 'SUCCESS' | 'FAILED';
  symbol: string;
  direction: 'LONG' | 'SHORT';
  amount: number;
  collateralUsd: number;
  leverage: number;
  orderId?: number;
  clientOrderId?: string;
  txSignature?: string;
  error?: string;
}

export class PacificaExecutor {

  supportsSymbol(symbol: string): boolean {
    return symbol.toUpperCase() in PACIFICA_MARKETS;
  }

  getSupportedSymbols(): string[] {
    return Object.keys(PACIFICA_MARKETS);
  }

  getMaxLeverage(symbol: string): number {
    return PACIFICA_MARKETS[symbol.toUpperCase()] || 1;
  }

  /**
   * Recursively sort object keys alphabetically (required by Pacifica signing)
   */
  private sortKeysDeep(obj: any): any {
    if (Array.isArray(obj)) return obj.map(v => this.sortKeysDeep(v));
    if (obj !== null && typeof obj === 'object') {
      return Object.keys(obj).sort().reduce((acc: any, k) => {
        acc[k] = this.sortKeysDeep(obj[k]);
        return acc;
      }, {});
    }
    return obj;
  }

  /**
   * Sign a payload using Ed25519 (Solana keypair)
   * Pacifica canonical format: sort keys recursively, compact JSON (no spaces)
   */
  private sign(payload: Record<string, any>, keypair: Keypair): string {
    const sorted = this.sortKeysDeep(payload);
    const message = Buffer.from(JSON.stringify(sorted, null, 0));
    const sig = nacl.sign.detached(message, keypair.secretKey);
    return bs58.encode(sig);
  }

  /**
   * Build the canonical signed payload structure Pacifica expects:
   *   { data: { ...orderFields }, expiry_window, timestamp, type }
   * This nested object is what gets signed (after sorting).
   * The final POST body is the flat merge of header + data + signature + account.
   */
  private buildSignedRequest(
    keypair: Keypair,
    type: string,
    orderFields: Record<string, any>,
    expiryWindow = 10000,
    mainAccount?: string,  // If set, keypair is agent key; mainAccount is the depositing wallet
  ): Record<string, any> {
    const timestamp = Date.now();
    const toSign = {
      data: orderFields,
      expiry_window: expiryWindow,
      timestamp,
      type,
    };
    const signature = this.sign(toSign, keypair);
    const body: Record<string, any> = {
      account: mainAccount || keypair.publicKey.toBase58(),
      ...orderFields,
      expiry_window: expiryWindow,
      timestamp,
      type,
      signature,
    };
    // If using agent key: include agent_wallet so Pacifica knows this is an agent signing
    if (mainAccount) {
      body.agent_wallet = keypair.publicKey.toBase58();
    }
    return body;
  }

  /**
   * Bind an agent wallet to a main account on Pacifica.
   * The bind request is signed by the MAIN wallet (Phantom) on the frontend,
   * and forwarded here to call the Pacifica API.
   */
  async bindAgentWallet(signedBindPayload: Record<string, any>): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await axios.post(`${PACIFICA_API}/agent/bind`, signedBindPayload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
      });
      console.log('[Pacifica] Agent wallet bound:', res.data);
      return { success: true };
    } catch (err: any) {
      const msg = err.response?.data?.message || err.response?.data?.error || err.message;
      console.error('[Pacifica] Bind agent wallet failed:', msg);
      return { success: false, error: msg };
    }
  }

  /**
   * Get current mark price for a symbol from Pacifica markets
   */
  private async getMarkPrice(symbol: string): Promise<number> {
    try {
      const res = await axios.get(`${PACIFICA_API}/markets`, { timeout: 8000 });
      const markets = res.data?.markets || res.data || [];
      const market = markets.find((m: any) =>
        (m.symbol || m.name || '').toUpperCase() === symbol.toUpperCase()
      );
      if (market?.mark_price) return parseFloat(market.mark_price);
      if (market?.last_price) return parseFloat(market.last_price);
      if (market?.price) return parseFloat(market.price);
    } catch (err: any) {
      console.warn(`[Pacifica] Failed to get mark price for ${symbol}:`, err.message);
    }
    // Fallback: use a simple price oracle via Binance public API
    try {
      const sym = symbol === 'XAU' ? 'XAUUSDT'
                : symbol === 'XAG' ? 'XAGUSDT'
                : `${symbol}USDT`;
      const r = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}`, { timeout: 5000 });
      return parseFloat(r.data.price);
    } catch {
      throw new Error(`Cannot get price for ${symbol}`);
    }
  }

  /**
   * Execute a leveraged perp trade on Pacifica
   * LONG = "bid", SHORT = "ask"
   */
  async executeSignal(
    keypair: Keypair,
    symbol: string,
    direction: 'LONG' | 'SHORT',
    usdcAmount: number,
    mainAccount?: string,
  ): Promise<PacificaOrderResult> {
    const normalized = symbol.toUpperCase();
    if (!this.supportsSymbol(normalized)) {
      return { status: 'FAILED', symbol, direction, amount: 0, collateralUsd: usdcAmount, leverage: 0, error: `${symbol} not on Pacifica` };
    }

    const maxLev = this.getMaxLeverage(normalized);
    const leverage = Math.min(Number(process.env.PERP_LEVERAGE || '2'), maxLev);

    let markPrice: number;
    try {
      markPrice = await this.getMarkPrice(normalized);
    } catch (err: any) {
      return { status: 'FAILED', symbol, direction, amount: 0, collateralUsd: usdcAmount, leverage, error: err.message };
    }

    // amount = position notional in base token units
    // collateral = usdcAmount, position_notional = usdcAmount * leverage
    const positionNotionalUsd = usdcAmount * leverage;
    const baseAmount = positionNotionalUsd / markPrice;
    // Pacifica requires amounts as multiples of lot size 0.01 — round down to 2 decimal places
    const lotSize = 0.01;
    const roundedAmount = Math.floor(baseAmount / lotSize) * lotSize;
    const amountStr = roundedAmount.toFixed(2);

    const clientOrderId = uuidv4();

    const orderFields: Record<string, any> = {
      amount: amountStr,
      client_order_id: clientOrderId,
      reduce_only: false,
      side: direction === 'LONG' ? 'bid' : 'ask',
      slippage_percent: '1.0',
      symbol: normalized,
    };
    if (BUILDER_CODE) orderFields.builder_code = BUILDER_CODE;

    const payload = this.buildSignedRequest(keypair, 'create_market_order', orderFields, 10000, mainAccount);

    console.log(`[Pacifica] ${normalized} ${direction} $${usdcAmount} x${leverage} = ${amountStr} @ ~$${markPrice.toFixed(2)}`);
    console.log(`[Pacifica] Payload:`, JSON.stringify(payload));

    try {
      const res = await axios.post(`${PACIFICA_API}/orders/create_market`, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
      });

      const orderId = res.data?.order_id;
      console.log(`[Pacifica] Order placed: ${normalized} ${direction} orderId=${orderId}`);

      return {
        status: 'SUCCESS',
        symbol: normalized,
        direction,
        amount: parseFloat(amountStr),
        collateralUsd: usdcAmount,
        leverage,
        orderId,
        clientOrderId,
      };
    } catch (err: any) {
      const msg = err.response?.data?.message || err.response?.data?.error || err.message;
      console.error(`[Pacifica] Order failed for ${normalized}:`, msg);
      return { status: 'FAILED', symbol: normalized, direction, amount: 0, collateralUsd: usdcAmount, leverage, error: msg };
    }
  }

  /**
   * Close an open position using reduce_only market order
   */
  async closePosition(
    keypair: Keypair,
    symbol: string,
    direction: 'LONG' | 'SHORT',
    amount: number,
    mainAccount?: string,
  ): Promise<PacificaOrderResult> {
    const normalized = symbol.toUpperCase();
    const clientOrderId = uuidv4();

    // To close: use opposite side with reduce_only=true
    const closeSide = direction === 'LONG' ? 'ask' : 'bid';

    const orderFields: Record<string, any> = {
      amount: amount.toFixed(6),
      client_order_id: clientOrderId,
      reduce_only: true,
      side: closeSide,
      slippage_percent: '1.0',
      symbol: normalized,
    };
    if (BUILDER_CODE) orderFields.builder_code = BUILDER_CODE;

    const payload = this.buildSignedRequest(keypair, 'create_market_order', orderFields, 10000, mainAccount);

    try {
      const res = await axios.post(`${PACIFICA_API}/orders/create_market`, payload, { timeout: 15000 });
      return { status: 'SUCCESS', symbol: normalized, direction, amount, collateralUsd: 0, leverage: 0, orderId: res.data?.order_id };
    } catch (err: any) {
      const msg = err.response?.data?.message || err.response?.data?.error || err.message;
      return { status: 'FAILED', symbol: normalized, direction, amount, collateralUsd: 0, leverage: 0, error: msg };
    }
  }

  /**
   * Get open positions from Pacifica
   */
  async getPositions(walletAddress: string): Promise<any[]> {
    try {
      const res = await axios.get(`${PACIFICA_API}/positions`, {
        params: { account: walletAddress },
        timeout: 8000,
      });
      return res.data?.positions || res.data || [];
    } catch {
      return [];
    }
  }
}

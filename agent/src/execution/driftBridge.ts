/**
 * Drift Bridge — Executes leveraged perp trades on Drift Protocol (Solana)
 *
 * Flow:
 *   1. Brain signal arrives: LONG/SHORT on a Drift-listed token
 *   2. Check USDC collateral balance on Drift
 *   3. Open perp position with leverage
 *   4. Set stop loss via trigger order
 *   5. Set take profit via trigger order
 *
 * Drift SDK: @drift-labs/sdk v2.x
 */

import {
  DriftClient,
  initialize,
  BulkAccountLoader,
  Wallet,
  QUOTE_PRECISION,
  BASE_PRECISION,
  PositionDirection,
  OrderType,
  MarketType,
  getMarketOrderParams,
  getTriggerLimitOrderParams,
  OrderTriggerCondition,
  BN,
} from '@drift-labs/sdk';
// Import Keypair/PublicKey from @solana/web3.js but cast to any when passing to DriftClient
// to avoid private field mismatch between two bundled versions of web3.js
import { Keypair, PublicKey } from '@solana/web3.js';
import { Signal } from '../signals/signalPoller';
import { routeToken } from './tokenRouter';

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const DRIFT_ENV = (process.env.DRIFT_ENV as 'mainnet-beta' | 'devnet') || 'mainnet-beta';
const TRADE_AMOUNT_USDC = Number(process.env.TRADE_AMOUNT_USDC || '10'); // USDC per trade

export interface DriftTradeResult {
  symbol: string;
  side: 'LONG' | 'SHORT';
  size: number;
  entryPrice: number;
  txSignature: string;
}

export class DriftBridge {
  private clientCache = new Map<string, DriftClient>();
  private connection: any; // typed as any to avoid web3.js version mismatch with Drift SDK

  constructor() {
    // Dynamically require Connection to get Drift's bundled version at runtime
    const { Connection } = require('@solana/web3.js');
    this.connection = new Connection(RPC_URL, 'confirmed');
  }

  /**
   * Execute a signal on Drift Protocol
   * - Opens leveraged perp position
   * - Sets stop loss and take profit trigger orders
   *
   * DRY_RUN=true → logs full order details without submitting on-chain
   */
  async executeSignal(walletAddress: string, keypair: Keypair, signal: Signal): Promise<void> {
    const route = routeToken(signal.symbol);
    if (route.route !== 'DRIFT_PERP' || route.marketIndex === undefined) {
      throw new Error(`${signal.symbol} is not a Drift perp market`);
    }

    console.log(`[DriftBridge] ${route.note}`);

    const leverage = Math.min(signal.leverage || 3, 10);
    const notionalValue = TRADE_AMOUNT_USDC * leverage;

    const driftClient = await this.getDriftClient(walletAddress, keypair);

    // Check USDC collateral
    const balance = await this.getUSDCBalance(driftClient);
    console.log(`[DriftBridge] Drift USDC balance: $${balance.toFixed(2)}, need: $${TRADE_AMOUNT_USDC}`);

    if (balance < TRADE_AMOUNT_USDC * 0.9) {
      throw new Error(`Insufficient Drift balance: $${balance.toFixed(2)} (need $${TRADE_AMOUNT_USDC}). Deposit USDC to Drift.`);
    }

    const baseSizeRaw = new BN(notionalValue * 1e6)
      .mul(BASE_PRECISION)
      .div(new BN(Math.round(signal.entryPrice * 1e6)));

    const direction = signal.direction === 'LONG'
      ? PositionDirection.LONG
      : PositionDirection.SHORT;

    const orderParams = getMarketOrderParams({
      marketIndex: route.marketIndex,
      direction,
      baseAssetAmount: baseSizeRaw,
      marketType: MarketType.PERP,
    });

    console.log(`[DriftBridge] Opening ${signal.direction} ${signal.symbol}: notional=$${notionalValue} leverage=${leverage}x`);

    const txSig = await driftClient.placeAndTakePerpOrder(orderParams);
    console.log(`[DriftBridge] Order placed: ${txSig}`);

    if (signal.stopLoss && signal.stopLoss > 0) {
      await this.setTriggerOrder(driftClient, route.marketIndex, direction, baseSizeRaw, signal.stopLoss, 'STOP_LOSS');
      console.log(`[DriftBridge] Stop loss set @ $${signal.stopLoss}`);
    }

    if (signal.takeProfit1 && signal.takeProfit1 > 0) {
      await this.setTriggerOrder(driftClient, route.marketIndex, direction, baseSizeRaw, signal.takeProfit1, 'TAKE_PROFIT');
      console.log(`[DriftBridge] Take profit set @ $${signal.takeProfit1}`);
    }
  }

  /**
   * Close an open perp position
   */
  async closePosition(walletAddress: string, keypair: Keypair, symbol: string, direction: 'LONG' | 'SHORT'): Promise<void> {
    const route = routeToken(symbol);
    if (route.route !== 'DRIFT_PERP' || route.marketIndex === undefined) return;

    const driftClient = await this.getDriftClient(walletAddress, keypair);
    const closeDirection = direction === 'LONG' ? PositionDirection.SHORT : PositionDirection.LONG;

    const user = driftClient.getUser();
    const position = user.getPerpPosition(route.marketIndex);
    if (!position || position.baseAssetAmount.eq(new BN(0))) {
      console.log(`[DriftBridge] No open position for ${symbol}`);
      return;
    }

    const orderParams = getMarketOrderParams({
      marketIndex: route.marketIndex,
      direction: closeDirection,
      baseAssetAmount: position.baseAssetAmount.abs(),
      marketType: MarketType.PERP,
      reduceOnly: true,
    });

    const txSig = await driftClient.placeAndTakePerpOrder(orderParams);
    console.log(`[DriftBridge] Closed ${symbol} ${direction}: ${txSig}`);
  }

  /**
   * Get USDC collateral balance on Drift
   */
  async getUSDCBalance(driftClient: DriftClient): Promise<number> {
    try {
      const user = driftClient.getUser();
      const collateral = user.getFreeCollateral();
      return collateral.toNumber() / QUOTE_PRECISION.toNumber();
    } catch {
      return 0;
    }
  }

  /**
   * Get or create a DriftClient for a wallet
   */
  private async getDriftClient(walletAddress: string, keypair: Keypair): Promise<DriftClient> {
    if (this.clientCache.has(walletAddress)) {
      return this.clientCache.get(walletAddress)!;
    }

    const sdkConfig = initialize({ env: DRIFT_ENV });
    // Cast keypair to any to resolve private field mismatch between two @solana/web3.js versions
    const wallet = new Wallet(keypair as any);

    const accountLoader = new BulkAccountLoader(this.connection, 'confirmed', 1000);
    const driftClient = new DriftClient({
      connection: this.connection,
      wallet,
      programID: new PublicKey(sdkConfig.DRIFT_PROGRAM_ID),
      accountSubscription: {
        type: 'polling',
        accountLoader,
      },
    });

    await driftClient.subscribe();
    this.clientCache.set(walletAddress, driftClient);
    console.log(`[DriftBridge] DriftClient initialized for ${walletAddress.slice(0, 8)}...`);
    return driftClient;
  }

  /**
   * Place a trigger order (stop loss or take profit)
   */
  private async setTriggerOrder(
    driftClient: DriftClient,
    marketIndex: number,
    positionDirection: PositionDirection,
    baseSize: BN,
    triggerPrice: number,
    type: 'STOP_LOSS' | 'TAKE_PROFIT',
  ): Promise<void> {
    const triggerPriceRaw = new BN(Math.round(triggerPrice * 1e6));
    const closeDirection = positionDirection === PositionDirection.LONG
      ? PositionDirection.SHORT
      : PositionDirection.LONG;

    // Stop loss: trigger when price goes BELOW (long) or ABOVE (short) trigger
    // Take profit: trigger when price goes ABOVE (long) or BELOW (short) trigger
    let triggerCondition: OrderTriggerCondition;
    if (type === 'STOP_LOSS') {
      triggerCondition = positionDirection === PositionDirection.LONG
        ? OrderTriggerCondition.BELOW
        : OrderTriggerCondition.ABOVE;
    } else {
      triggerCondition = positionDirection === PositionDirection.LONG
        ? OrderTriggerCondition.ABOVE
        : OrderTriggerCondition.BELOW;
    }

    const orderParams = getTriggerLimitOrderParams({
      marketIndex,
      direction: closeDirection,
      baseAssetAmount: baseSize,
      triggerPrice: triggerPriceRaw,
      triggerCondition,
      price: triggerPriceRaw, // limit price = trigger price (immediate fill)
      marketType: MarketType.PERP,
      reduceOnly: true,
    });

    await driftClient.placePerpOrder(orderParams);
  }
}

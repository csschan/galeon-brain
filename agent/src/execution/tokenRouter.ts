/**
 * Token Router — Routes trade execution
 *
 * Decision logic:
 *   Token on Pacifica → PACIFICA_PERP (leveraged long/short, 50+ markets)
 *   Token not on Pacifica → JUPITER_SPOT (spot swap via Jupiter Aggregator)
 *
 * Pacifica supports: crypto (BTC/ETH/SOL/WIF/STRK...), equities (NVDA/TSLA...),
 * FX (EURUSD/USDJPY), commodities (XAU/CL...) — far broader than any other Solana DEX.
 */

// All Pacifica perp markets
const PACIFICA_PERP_SYMBOLS = new Set([
  // Crypto
  'BTC', 'ETH', 'SOL', 'BNB', 'DOGE', 'HYPE', 'XRP',
  'AAVE', 'ADA', 'ARB', 'AVAX', 'BCH', 'CRV', 'ENA', 'FARTCOIN',
  'JUP', 'LDO', 'LINK', 'LTC', 'NEAR', 'SUI', 'TAO', 'TRUMP', 'UNI',
  'PUMP', 'kBONK', 'kPEPE', 'ICP', 'PENGU', 'STRK', 'VIRTUAL',
  'WIF', 'WLD', 'ZK', 'ZRO',
  // Equities
  'NVDA', 'TSLA', 'MSTR', 'GOOGL', 'HOOD', 'PLTR', 'CRCL',
  // Commodities
  'XAU', 'XAG', 'CL', 'NATGAS', 'COPPER',
  // Indices
  'SP500',
  // FX
  'EURUSD', 'USDJPY',
]);

export type ExecutionRoute = 'PACIFICA_PERP' | 'JUPITER_SPOT';

export interface RouteResult {
  route: ExecutionRoute;
  symbol: string;
  note: string;
}

function normalizeSymbol(raw: string): string {
  return raw.replace(/USDT$|PERP$|-PERP$|USD$/, '').replace(/\/.*/, '').toUpperCase();
}

export function routeToken(symbol: string): RouteResult {
  const normalized = normalizeSymbol(symbol);

  if (PACIFICA_PERP_SYMBOLS.has(normalized)) {
    return {
      route: 'PACIFICA_PERP',
      symbol: normalized,
      note: `${normalized} → Pacifica perp (leveraged)`,
    };
  }

  return {
    route: 'JUPITER_SPOT',
    symbol: normalized,
    note: `${normalized} → Jupiter spot swap`,
  };
}

export function getSupportedPerpSymbols(): string[] {
  return Array.from(PACIFICA_PERP_SYMBOLS);
}

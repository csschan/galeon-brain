/**
 * Solana Wallet Store — Persists wallet address → strategy mappings
 * Replaces hlAddressStore from NEAR version
 */

import * as fs from 'fs';
import * as path from 'path';

const STORE_FILE = path.join(process.cwd(), '.solana-wallets.json');

interface WalletEntry {
  walletAddress: string;
  strategy: string;
  registeredAt: string;
}

class SolanaWalletStore {
  private store = new Map<string, WalletEntry>();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(STORE_FILE)) {
        const data = JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8'));
        for (const entry of Object.values(data) as WalletEntry[]) {
          this.store.set(entry.walletAddress, entry);
        }
      }
    } catch {}
  }

  private save(): void {
    try {
      const data: Record<string, WalletEntry> = {};
      this.store.forEach((v, k) => { data[k] = v; });
      fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2));
    } catch {}
  }

  set(walletAddress: string, strategy = 'stable'): void {
    this.store.set(walletAddress, {
      walletAddress,
      strategy,
      registeredAt: new Date().toISOString(),
    });
    this.save();
  }

  getStrategy(walletAddress: string): string {
    return this.store.get(walletAddress)?.strategy || 'stable';
  }

  has(walletAddress: string): boolean {
    return this.store.has(walletAddress);
  }

  getAll(): WalletEntry[] {
    return Array.from(this.store.values());
  }
}

export const solanaWalletStore = new SolanaWalletStore();

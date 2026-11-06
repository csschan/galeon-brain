/**
 * Solana Key Manager — Stores and uses agent keypairs for signing
 * Keys are persisted to disk so they survive restarts
 *
 * Pattern mirrors NEAR Function-Call Key but uses Solana Keypair.
 * The agent wallet is a delegated keypair authorized by the user.
 */

import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import * as fs from 'fs';
import * as path from 'path';

const KEYS_FILE = path.join(process.cwd(), '.agent-keys.json');

interface RegisteredWallet {
  walletAddress: string;  // agent keypair public key (base58)
  secretKey: string;      // agent keypair secret key (base58)
  mainAccount?: string;   // user's Phantom wallet address (the Pacifica depositing account)
  strategy: string;
  registeredAt: string;
}

export class SolanaKeyManager {
  private wallets = new Map<string, RegisteredWallet>();

  constructor() {
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(KEYS_FILE)) {
        const data = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8'));
        for (const wallet of Object.values(data) as RegisteredWallet[]) {
          this.wallets.set(wallet.walletAddress, wallet);
          console.log(`[SolanaKeyManager] Restored wallet ${wallet.walletAddress.slice(0, 8)}...`);
        }
      }
    } catch (err) {
      console.error('[SolanaKeyManager] Failed to load keys from disk:', err);
    }
  }

  private saveToDisk(): void {
    try {
      const data: Record<string, RegisteredWallet> = {};
      this.wallets.forEach((v, k) => { data[k] = v; });
      fs.writeFileSync(KEYS_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('[SolanaKeyManager] Failed to save keys to disk:', err);
    }
  }

  registerWallet(walletAddress: string, secretKey: string, strategy = 'stable', mainAccount?: string): void {
    const keypair = Keypair.fromSecretKey(bs58.decode(secretKey));
    if (keypair.publicKey.toBase58() !== walletAddress) {
      throw new Error('Secret key does not match wallet address');
    }
    this.wallets.set(walletAddress, {
      walletAddress,
      secretKey,
      mainAccount,
      strategy,
      registeredAt: new Date().toISOString(),
    });
    this.saveToDisk();
    console.log(`[SolanaKeyManager] Registered agent wallet ${walletAddress.slice(0, 8)}... mainAccount=${mainAccount?.slice(0, 8) || 'none'}...`);
  }

  revokeWallet(walletAddress: string): void {
    this.wallets.delete(walletAddress);
    this.saveToDisk();
    console.log(`[SolanaKeyManager] Revoked wallet ${walletAddress}`);
  }

  getKeypair(walletAddress: string): Keypair {
    const wallet = this.wallets.get(walletAddress);
    if (!wallet) throw new Error(`No keypair registered for ${walletAddress}`);
    return Keypair.fromSecretKey(bs58.decode(wallet.secretKey));
  }

  getPublicKey(walletAddress: string): PublicKey {
    return this.getKeypair(walletAddress).publicKey;
  }

  hasWallet(walletAddress: string): boolean {
    return this.wallets.has(walletAddress);
  }

  getRegisteredWallets(): string[] {
    return Array.from(this.wallets.keys());
  }

  getStrategy(walletAddress: string): string {
    return this.wallets.get(walletAddress)?.strategy || 'stable';
  }

  getMainAccount(walletAddress: string): string | undefined {
    return this.wallets.get(walletAddress)?.mainAccount;
  }

  getWalletInfo(walletAddress: string): { walletAddress: string; registeredAt: string; strategy: string; mainAccount?: string } | null {
    const wallet = this.wallets.get(walletAddress);
    if (!wallet) return null;
    return {
      walletAddress: wallet.walletAddress,
      registeredAt: wallet.registeredAt,
      strategy: wallet.strategy,
      mainAccount: wallet.mainAccount,
    };
  }
}

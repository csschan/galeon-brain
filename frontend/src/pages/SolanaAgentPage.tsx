/**
 * SolanaAgentPage.tsx
 * Solana Hackathon entry point.
 * Shows SolanaAgentSetup until wallet is registered, then shows AgentDashboard.
 */

import React, { useState } from 'react';
import { RobotOutlined } from '@ant-design/icons';
import SolanaAgentSetup from '../components/nearAgent/SolanaAgentSetup';
import AgentDashboard from '../components/nearAgent/AgentDashboard';
import { AGENT_SERVICE_URL } from '../config/near';

const SolanaAgentPage: React.FC = () => {
  const [walletAddress, setWalletAddress] = useState<string | null>(() =>
    localStorage.getItem('solana_agent_wallet')
  );

  const handleRegistered = (addr: string) => {
    localStorage.setItem('solana_agent_wallet', addr);
    setWalletAddress(addr);
  };

  const handleRevoke = async () => {
    if (!walletAddress) return;
    try {
      await fetch(`${AGENT_SERVICE_URL}/api/agent/revoke-wallet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress }),
      });
    } catch {}
    localStorage.removeItem('solana_agent_wallet');
    setWalletAddress(null);
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(160deg, #f5f0ff 0%, #f5f7fa 50%, #edf5ff 100%)',
      padding: '32px 24px',
    }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            background: '#9945FF',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <RobotOutlined style={{ fontSize: 20, color: '#fff' }} />
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#111', lineHeight: 1.3 }}>
              Galeon Brain — Solana
            </div>
            <div style={{ fontSize: 13, color: '#9ca3af', marginTop: 1 }}>
              Fusion Agent · Pacifica Finance perps + Jupiter spot
            </div>
          </div>
        </div>

        {walletAddress
          ? <AgentDashboard accountId={walletAddress} onRevoke={handleRevoke} />
          : <SolanaAgentSetup onComplete={handleRegistered} />
        }
      </div>
    </div>
  );
};

export default SolanaAgentPage;

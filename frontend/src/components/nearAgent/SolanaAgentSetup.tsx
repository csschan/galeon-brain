/**
 * SolanaAgentSetup.tsx — Solana Hackathon
 *
 * Flow:
 *  Step 0: Connect Phantom wallet (user identity)
 *  Step 1: Auto-generate agent keypair in browser → show address → user funds it
 *  Step 2: Register agent keypair with backend → Start Brain
 */

import React, { useState, useEffect } from 'react';
import { Button, message } from 'antd';
import {
  WalletOutlined, RocketOutlined, CheckCircleOutlined,
  ArrowRightOutlined, CopyOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { AGENT_SERVICE_URL } from '../../config/near';

// ── Solana keypair generation (uses @solana/web3.js already in node_modules) ──
async function generateAgentKeypair(): Promise<{ publicKey: string; secretKey: string }> {
  // Dynamically import to avoid SSR issues
  const { Keypair } = await import('@solana/web3.js');
  const bs58 = await import('bs58');
  const kp = Keypair.generate();
  const secretKey = bs58.default ? bs58.default.encode(kp.secretKey) : (bs58 as any).encode(kp.secretKey);
  return { publicKey: kp.publicKey.toBase58(), secretKey };
}

const glass: React.CSSProperties = {
  background: 'rgba(255,255,255,0.80)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  borderRadius: 16,
  border: '1px solid rgba(255,255,255,0.9)',
  boxShadow: '0 2px 20px rgba(0,0,0,0.05)',
  padding: '32px 36px',
};

const BRAIN_STATS = [
  { label: 'Total Trades',  value: '7,704' },
  { label: 'Win Rate',      value: '59.3%' },
  { label: 'Cumul. Return', value: '+244%' },
  { label: 'Decision Acc.', value: '68.7%' },
];

const STEPS = [
  { label: 'Connect Phantom' },
  { label: 'Authorize Agent Key' },
  { label: 'Start Brain' },
];

interface Props { onComplete?: (walletAddress: string) => void; }

const SolanaAgentSetup: React.FC<Props> = ({ onComplete }) => {
  const [step, setStep]           = useState(0);
  const [phantomAddr, setPhantomAddr] = useState<string | null>(null);
  const [agentKeypair, setAgentKeypair] = useState<{ publicKey: string; secretKey: string } | null>(null);
  const [strategy, setStrategy]   = useState('stable');
  const [loading, setLoading]     = useState(false);
  const [registered, setRegistered] = useState(false);
  const [copied, setCopied]       = useState(false);

  // Restore agent keypair from localStorage (persist across refreshes)
  useEffect(() => {
    const stored = localStorage.getItem('solana_agent_keypair');
    if (stored) {
      try { setAgentKeypair(JSON.parse(stored)); } catch {}
    }
  }, []);

  const connectPhantom = async () => {
    const provider = (window as any).solana;
    if (!provider?.isPhantom) {
      message.error('Phantom wallet not found — please install it first');
      return;
    }
    try {
      const resp = await provider.connect();
      setPhantomAddr(resp.publicKey.toString());
      // Generate agent keypair if not already done
      if (!agentKeypair) {
        const kp = await generateAgentKeypair();
        setAgentKeypair(kp);
        localStorage.setItem('solana_agent_keypair', JSON.stringify(kp));
      }
      setStep(1);
    } catch (err: any) {
      message.error('Phantom connection rejected');
    }
  };

  const regenerateKeypair = async () => {
    const kp = await generateAgentKeypair();
    setAgentKeypair(kp);
    localStorage.setItem('solana_agent_keypair', JSON.stringify(kp));
  };

  const copyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Step 1: Phantom signs bind_agent_wallet → server forwards to Pacifica
  const authorizeAgentKey = async () => {
    if (!agentKeypair || !phantomAddr) return;
    const provider = (window as any).solana;
    setLoading(true);
    try {
      const bs58 = await import('bs58');
      const timestamp = Date.now();
      const expiryWindow = 10000;
      // Build canonical payload (same sorting logic as server)
      const toSign = {
        data: { agent_wallet: agentKeypair.publicKey },
        expiry_window: expiryWindow,
        timestamp,
        type: 'bind_agent_wallet',
      };
      const sortKeys = (obj: any): any => {
        if (Array.isArray(obj)) return obj.map(sortKeys);
        if (obj && typeof obj === 'object') {
          return Object.keys(obj).sort().reduce((acc: any, k) => { acc[k] = sortKeys(obj[k]); return acc; }, {});
        }
        return obj;
      };
      const canonical = JSON.stringify(sortKeys(toSign), null, 0);
      const msgBytes = new TextEncoder().encode(canonical);
      // Phantom signs the message
      const { signature } = await provider.signMessage(msgBytes, 'utf8');
      const sigBs58 = bs58.default ? bs58.default.encode(signature) : (bs58 as any).encode(signature);
      // Forward signed bind request to Pacifica via our agent server
      const res = await fetch(`${AGENT_SERVICE_URL}/api/agent/bind-agent-wallet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account: phantomAddr,
          agent_wallet: agentKeypair.publicKey,
          signature: sigBs58,
          timestamp,
          expiry_window: expiryWindow,
          type: 'bind_agent_wallet',
        }),
      });
      const data = await res.json();
      if (data.success) {
        message.success(data.message || 'Agent key authorized on Pacifica!');
        setStep(2);
      } else {
        // If error suggests already bound, skip to next step
        const errMsg = (data.error || '').toLowerCase();
        if (errMsg.includes('already') || errMsg.includes('exists') || errMsg.includes('bound')) {
          message.success('Agent key already authorized');
          setStep(2);
        } else {
          message.error(data.error || 'Bind failed');
        }
      }
    } catch (err: any) {
      message.error(`Authorization failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const startBrain = async () => {
    if (!agentKeypair) return;
    setLoading(true);
    try {
      const res = await fetch(`${AGENT_SERVICE_URL}/api/agent/register-wallet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: agentKeypair.publicKey,
          secretKey: agentKeypair.secretKey,
          strategy,
          mainAccount: phantomAddr,  // Store Phantom address so agent uses it as 'account' in orders
        }),
      });
      const data = await res.json();
      if (data.success) {
        setRegistered(true);
        message.success('Galeon Brain activated on Solana!');
      } else {
        message.error(data.error || 'Registration failed');
      }
    } catch (err: any) {
      message.error(`Agent unreachable: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ── Step bar ──────────────────────────────────────────────────────────────────
  const StepBar = () => (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24 }}>
      {STEPS.map((s, i) => (
        <React.Fragment key={i}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700,
              background: step > i ? '#9945FF' : step === i ? '#f3eeff' : '#f0f0f0',
              color: step > i ? '#fff' : step === i ? '#9945FF' : '#bbb',
              border: step === i ? '2px solid #9945FF' : '2px solid transparent',
            }}>
              {step > i ? <CheckCircleOutlined style={{ fontSize: 13 }} /> : i + 1}
            </div>
            <span style={{
              fontSize: 13,
              fontWeight: step === i ? 600 : 400,
              color: step === i ? '#111' : step > i ? '#9945FF' : '#bbb',
            }}>{s.label}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div style={{ flex: 1, height: 1, margin: '0 12px', background: step > i ? '#9945FF' : '#e5e7eb' }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );

  // ── Step 0: Connect Phantom ───────────────────────────────────────────────────
  const renderConnectStep = () => (
    <div style={glass}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{
          width: 64, height: 64, borderRadius: 18, margin: '0 auto 16px',
          background: 'linear-gradient(135deg, #9945FF, #14F195)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 32,
        }}>
          👻
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#111', marginBottom: 6 }}>
          Connect Phantom Wallet
        </div>
        <div style={{ fontSize: 13, color: '#6b7280', maxWidth: 400, margin: '0 auto' }}>
          Connect your Phantom wallet to identify yourself. Galeon Brain will generate a separate agent wallet — your main wallet stays safe.
        </div>
      </div>

      {/* Brain stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 28 }}>
        {BRAIN_STATS.map(s => (
          <div key={s.label} style={{
            textAlign: 'center', padding: '14px 8px', borderRadius: 12,
            background: 'rgba(153,69,255,0.04)', border: '1px solid rgba(153,69,255,0.12)',
          }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#9945FF', letterSpacing: -0.5 }}>{s.value}</div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <Button
        size="large" block icon={<span style={{ fontSize: 18, marginRight: 4 }}>👻</span>}
        onClick={connectPhantom}
        style={{
          height: 52, fontSize: 15, borderRadius: 12,
          background: 'linear-gradient(135deg, #9945FF, #14F195)',
          border: 'none', color: '#fff', fontWeight: 700,
        }}
      >
        Connect Phantom
      </Button>
    </div>
  );

  // ── Step 1: Authorize Agent Key on Pacifica ──────────────────────────────────
  const renderFundStep = () => (
    <div style={glass}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: 'linear-gradient(135deg, #9945FF, #14F195)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
        }}>🔐</div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>Authorize Agent Key</div>
          <div style={{ fontSize: 13, color: '#6b7280' }}>
            Connected as: <span style={{ fontFamily: 'monospace', color: '#9945FF' }}>
              {phantomAddr?.slice(0, 8)}...{phantomAddr?.slice(-6)}
            </span>
          </div>
        </div>
      </div>

      {/* Agent wallet address display */}
      <div style={{
        background: '#f8f4ff', border: '1.5px solid rgba(153,69,255,0.2)',
        borderRadius: 12, padding: '16px 18px', marginBottom: 16,
      }}>
        <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 6 }}>Agent Key Address (auto-generated)</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <code style={{ flex: 1, fontSize: 12, wordBreak: 'break-all', color: '#374151', background: 'transparent' }}>
            {agentKeypair?.publicKey}
          </code>
          <Button size="small" type="text" icon={<CopyOutlined />}
            onClick={() => copyAddress(agentKeypair?.publicKey || '')}
            style={{ color: copied ? '#52c41a' : '#9945FF', flexShrink: 0 }}>
            {copied ? 'Copied!' : 'Copy'}
          </Button>
          <Button size="small" type="text" icon={<ReloadOutlined />}
            onClick={regenerateKeypair} style={{ color: '#9ca3af', flexShrink: 0 }} title="Regenerate" />
        </div>
      </div>

      {/* Security explanation */}
      <div style={{
        background: '#f0fdf4', border: '1px solid #bbf7d0',
        borderRadius: 10, padding: '14px 16px', marginBottom: 20, fontSize: 13, color: '#166534',
      }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>🔒 Secure by design</div>
        <div style={{ lineHeight: 1.8 }}>
          Your funds stay in your <strong>Pacifica account</strong>.<br />
          This agent key can <strong>trade only</strong> — it cannot withdraw funds.<br />
          Even if compromised, attackers cannot move your USDC out.
        </div>
      </div>

      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16, lineHeight: 1.7 }}>
        Make sure you have deposited USDC to <strong>pacifica.fi</strong> with your Phantom wallet first,
        then click below to authorize this agent key with one Phantom signature.
      </div>

      <Button
        type="primary" size="large" block loading={loading}
        icon={<span style={{ fontSize: 16 }}>👻</span>}
        onClick={authorizeAgentKey}
        style={{ height: 52, borderRadius: 12, background: 'linear-gradient(135deg, #9945FF, #14F195)', border: 'none', fontWeight: 700, fontSize: 15 }}
      >
        Sign with Phantom to Authorize
      </Button>
    </div>
  );

  // ── Step 2: Start Brain ───────────────────────────────────────────────────────
  const renderStartStep = () => (
    <div style={glass}>
      {registered ? (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%', margin: '0 auto 14px',
            background: 'linear-gradient(135deg, #9945FF, #14F195)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <CheckCircleOutlined style={{ fontSize: 32, color: '#fff' }} />
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#111', marginBottom: 4 }}>Brain is Active</div>
          <div style={{ fontSize: 13, color: '#9ca3af', fontFamily: 'monospace' }}>
            {agentKeypair?.publicKey.slice(0, 24)}...
          </div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 8 }}>
            Strategy: <strong>{strategy}</strong> · Signals polled every 30s
          </div>
          <Button
            type="primary" size="large"
            onClick={() => onComplete?.(agentKeypair?.publicKey || '')}
            style={{ marginTop: 20, height: 46, paddingInline: 36, borderRadius: 12, background: '#9945FF', border: 'none' }}
          >
            Go to Dashboard <ArrowRightOutlined />
          </Button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16, margin: '0 auto 14px',
              background: 'linear-gradient(135deg, #9945FF, #14F195)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <RocketOutlined style={{ fontSize: 26, color: '#fff' }} />
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#111', marginBottom: 6 }}>Start Galeon Brain</div>
            <div style={{ fontSize: 13, color: '#6b7280' }}>
              Autonomous trading on <strong>Pacifica Finance</strong> (perps) + <strong>Jupiter</strong> (spot)
            </div>
          </div>

          {/* Permissions */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              {
                title: 'Allowed', positive: true,
                items: ['Open/close Pacifica perp positions', 'Swap tokens via Jupiter', 'Follow Galeon Brain signals', 'Accept Fusion Agent intel'],
              },
              {
                title: 'Not Allowed', positive: false,
                items: ['Transfer funds to other accounts', 'Access your main Phantom wallet', 'Exceed $10 per trade'],
              },
            ].map(p => (
              <div key={p.title} style={{
                padding: '14px 16px', borderRadius: 12,
                background: p.positive ? 'rgba(82,196,26,0.04)' : 'rgba(255,77,79,0.04)',
                border: `1px solid ${p.positive ? 'rgba(82,196,26,0.15)' : 'rgba(255,77,79,0.15)'}`,
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: p.positive ? '#389e0d' : '#cf1322', marginBottom: 8 }}>
                  {p.positive ? '✓' : '✗'} {p.title}
                </div>
                {p.items.map(item => (
                  <div key={item} style={{ fontSize: 12, color: '#6b7280', marginBottom: 4, paddingLeft: 2 }}>· {item}</div>
                ))}
              </div>
            ))}
          </div>

          {/* Strategy */}
          <div style={{ padding: '16px 18px', borderRadius: 12, background: '#fafafa', border: '1px solid #f0f0f0' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Strategy</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { key: 'stable',     label: 'Stable',     desc: 'Conservative, trend-following' },
                { key: 'aggressive', label: 'Aggressive', desc: 'Higher risk, higher reward' },
              ].map(s => (
                <div key={s.key} onClick={() => setStrategy(s.key)} style={{
                  flex: 1, padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
                  border: `1.5px solid ${strategy === s.key ? '#9945FF' : '#e5e7eb'}`,
                  background: strategy === s.key ? 'rgba(153,69,255,0.05)' : '#fff',
                  transition: 'all 0.2s',
                }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: strategy === s.key ? '#9945FF' : '#374151' }}>{s.label}</div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{s.desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#874d00' }}>
            <strong>Mainnet notice:</strong> Real trades will execute. Brain targets $10 USDC per signal.
          </div>

          <Button
            type="primary" size="large" icon={<RocketOutlined />}
            loading={loading} block
            style={{ height: 48, fontSize: 15, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #9945FF, #7c3aed)' }}
            onClick={startBrain}
          >
            Start Galeon Brain
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div style={{ maxWidth: 620, margin: '0 auto' }}>
      <StepBar />
      {step === 0 && renderConnectStep()}
      {step === 1 && renderFundStep()}
      {step === 2 && renderStartStep()}
    </div>
  );
};

export default SolanaAgentSetup;

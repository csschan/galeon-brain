/**
 * Step 2: Strategy Selector
 * User picks an AI trading strategy before authorizing Agent
 * Fetches real strategy performance data from ai-server
 */

import React, { useState, useEffect } from 'react';
import { Card, Radio, Spin, Statistic, Row, Col, Tag } from 'antd';
import { TrophyOutlined, RiseOutlined, ThunderboltOutlined } from '@ant-design/icons';
import axios from 'axios';

interface StrategyOverview {
  totalTrades: number;
  winRate: number;
  totalPnl: number;
  totalPnlPercent: number;
  openPositions: number;
  avgHoldHours: number;
}

interface StrategySelectorProps {
  selectedStrategy: string;
  onStrategyChange: (strategy: string) => void;
}

const API_BASE = (() => {
  const host = window.location.hostname;
  if (host.includes('testai.galeon.world')) return 'https://testaiservice.galeon.world/api';
  if (host.includes('testai.gameland.network')) return 'https://testaiservice.gameland.network/api';
  if (host.includes('localhost') || host.includes('127.0.0.1')) return 'https://testaiservice.galeon.world/api';
  return 'https://galeon.gameland.network/api';
})();

const StrategySelector: React.FC<StrategySelectorProps> = ({ selectedStrategy, onStrategyChange }) => {
  const [stableData, setStableData] = useState<StrategyOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await axios.get(`${API_BASE}/paper-trade/overview`, {
          params: { strategy: 'stable' },
        });
        if (res.data.success) {
          setStableData(res.data.data);
        }
      } catch (err) {
        console.error('[StrategySelector] Failed to fetch overview:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return <Spin tip="Loading strategies..." />;
  }

  return (
    <div>
      <Radio.Group
        value={selectedStrategy}
        onChange={e => onStrategyChange(e.target.value)}
        style={{ width: '100%' }}
      >
        <Row gutter={16}>
          <Col span={12}>
            <Radio.Button value="stable" style={{ width: '100%', height: 'auto', padding: 0 }}>
              <Card
                size="small"
                title={
                  <span>
                    <TrophyOutlined style={{ marginRight: 8 }} />
                    Stable Strategy
                    <Tag color="green" style={{ marginLeft: 8 }}>Recommended</Tag>
                  </span>
                }
                bordered={false}
                style={{
                  borderColor: selectedStrategy === 'stable' ? '#1890ff' : undefined,
                }}
              >
                {stableData ? (
                  <Row gutter={8}>
                    <Col span={8}>
                      <Statistic
                        title="Win Rate"
                        value={stableData.winRate}
                        suffix="%"
                        valueStyle={{ color: stableData.winRate >= 60 ? '#3f8600' : undefined, fontSize: 16 }}
                      />
                    </Col>
                    <Col span={8}>
                      <Statistic
                        title="Total PnL"
                        value={stableData.totalPnlPercent}
                        suffix="%"
                        prefix={stableData.totalPnlPercent >= 0 ? '+' : ''}
                        valueStyle={{ color: stableData.totalPnlPercent >= 0 ? '#3f8600' : '#cf1322', fontSize: 16 }}
                      />
                    </Col>
                    <Col span={8}>
                      <Statistic
                        title="Trades"
                        value={stableData.totalTrades}
                        valueStyle={{ fontSize: 16 }}
                      />
                    </Col>
                  </Row>
                ) : (
                  <p>Multi-dimensional voting system with 12+ signals, conservative risk management</p>
                )}
              </Card>
            </Radio.Button>
          </Col>
          <Col span={12}>
            <Radio.Button value="aggressive" style={{ width: '100%', height: 'auto', padding: 0 }}>
              <Card
                size="small"
                title={
                  <span>
                    <ThunderboltOutlined style={{ marginRight: 8 }} />
                    Aggressive Strategy
                    <Tag color="orange" style={{ marginLeft: 8 }}>High Risk</Tag>
                  </span>
                }
                bordered={false}
              >
                <p style={{ margin: 0, color: '#666' }}>
                  Higher leverage, shorter hold times, alpha signals from whale tracking
                </p>
              </Card>
            </Radio.Button>
          </Col>
        </Row>
      </Radio.Group>
    </div>
  );
};

export default StrategySelector;

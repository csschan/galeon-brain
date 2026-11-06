#!/bin/bash
# start-tunnel.sh — Opens SSH tunnel to Galeon testnet ai-server
# Local port 8080 → remote port 5000
# Keep this running in a terminal while using the agent

echo "[tunnel] Connecting to Galeon AI Server (testnet)..."
echo "[tunnel] Local: http://localhost:8080/api"
echo "[tunnel] Press Ctrl+C to disconnect"
echo ""

SSHPASS='28103977Qw!' sshpass -e ssh \
  -N \
  -L 8080:localhost:5000 \
  -o StrictHostKeyChecking=no \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  gameland@184.168.123.133

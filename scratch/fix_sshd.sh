#!/bin/bash
# 备份 sshd 配置
cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak

# 开启端口转发
sed -i 's/#GatewayPorts no/GatewayPorts yes/' /etc/ssh/sshd_config
sed -i 's/#AllowTcpForwarding yes/AllowTcpForwarding yes/' /etc/ssh/sshd_config
sed -i 's/#ClientAliveInterval 0/ClientAliveInterval 30/' /etc/ssh/sshd_config

# 如果还是注释状态则强制追加
grep -q "^GatewayPorts yes" /etc/ssh/sshd_config || echo "GatewayPorts yes" >> /etc/ssh/sshd_config
grep -q "^AllowTcpForwarding yes" /etc/ssh/sshd_config || echo "AllowTcpForwarding yes" >> /etc/ssh/sshd_config

echo "=== 当前生效的转发配置 ==="
grep -E "^GatewayPorts|^AllowTcpForwarding|^ClientAliveInterval" /etc/ssh/sshd_config

# 热重载 sshd（不断开已有连接）
systemctl reload sshd && echo "=== sshd reload 成功 ===" || service ssh reload && echo "=== service ssh reload 成功 ==="

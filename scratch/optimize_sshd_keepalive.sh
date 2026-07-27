#!/bin/bash
# 优化 SSHD 防止主动切断长连接隧道
cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak.$(date +%s)

# 清理旧配置
sed -i 's/#ClientAliveInterval.*/ClientAliveInterval 15/' /etc/ssh/sshd_config
sed -i 's/ClientAliveInterval.*/ClientAliveInterval 15/' /etc/ssh/sshd_config

sed -i 's/#ClientAliveCountMax.*/ClientAliveCountMax 10/' /etc/ssh/sshd_config
sed -i 's/ClientAliveCountMax.*/ClientAliveCountMax 10/' /etc/ssh/sshd_config

sed -i 's/#TCPKeepAlive.*/TCPKeepAlive yes/' /etc/ssh/sshd_config
sed -i 's/TCPKeepAlive.*/TCPKeepAlive yes/' /etc/ssh/sshd_config

sed -i 's/#MaxStartups.*/MaxStartups 100:30:200/' /etc/ssh/sshd_config
sed -i 's/MaxStartups.*/MaxStartups 100:30:200/' /etc/ssh/sshd_config

sed -i 's/#GatewayPorts.*/GatewayPorts yes/' /etc/ssh/sshd_config
sed -i 's/GatewayPorts.*/GatewayPorts yes/' /etc/ssh/sshd_config

sed -i 's/#AllowTcpForwarding.*/AllowTcpForwarding yes/' /etc/ssh/sshd_config
sed -i 's/AllowTcpForwarding.*/AllowTcpForwarding yes/' /etc/ssh/sshd_config

# 追加保底
grep -q "^ClientAliveInterval 15" /etc/ssh/sshd_config || echo "ClientAliveInterval 15" >> /etc/ssh/sshd_config
grep -q "^ClientAliveCountMax 10" /etc/ssh/sshd_config || echo "ClientAliveCountMax 10" >> /etc/ssh/sshd_config
grep -q "^TCPKeepAlive yes" /etc/ssh/sshd_config || echo "TCPKeepAlive yes" >> /etc/ssh/sshd_config
grep -q "^MaxStartups 100:30:200" /etc/ssh/sshd_config || echo "MaxStartups 100:30:200" >> /etc/ssh/sshd_config

echo "=== 更新后的 SSHD 配置 ==="
grep -E "^ClientAliveInterval|^ClientAliveCountMax|^TCPKeepAlive|^MaxStartups|^GatewayPorts|^AllowTcpForwarding" /etc/ssh/sshd_config

systemctl reload sshd || service ssh reload
echo "=== SSHD 热重载完成 ==="

#!/usr/bin/env bash
# Cloud-init: install Docker + Compose + git on Amazon Linux 2023 and prepare /opt/timeline.
# Deployment itself (clone, .env, certs, compose up) is done over SSH — see docs/AWS_DEPLOYMENT.md.
set -euxo pipefail

dnf update -y
dnf install -y docker git
systemctl enable --now docker
usermod -aG docker ec2-user

# Docker Compose v2 plugin (matches the box architecture via uname -m).
mkdir -p /usr/local/lib/docker/cli-plugins
curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

mkdir -p /opt/timeline
chown ec2-user:ec2-user /opt/timeline

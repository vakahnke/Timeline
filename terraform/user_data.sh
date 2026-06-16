#!/usr/bin/env bash
# Cloud-init: install Docker + Compose + git on Amazon Linux 2023 and prepare /opt/timeline.
# Deployment itself (clone, .env, certs, compose up) is done over SSH — see docs/AWS_DEPLOYMENT.md.
set -euxo pipefail

dnf update -y
dnf install -y docker git
systemctl enable --now docker
usermod -aG docker ec2-user

# Docker CLI plugins, pinned for reproducibility. NOTE: the dnf `docker` rpm bundles an
# older buildx (0.12.x) than recent Compose's `build` requires (>= 0.17), so we install a
# current buildx alongside Compose — otherwise `docker compose build` fails on the box.
# Arch naming differs between the projects: Compose uses `aarch64`/`x86_64`, buildx uses
# `arm64`/`amd64`.
ARCH="$(uname -m)"
case "$ARCH" in
  aarch64) BUILDX_ARCH=arm64 ;;
  x86_64)  BUILDX_ARCH=amd64 ;;
  *)       BUILDX_ARCH=amd64 ;;
esac
COMPOSE_VERSION=v2.32.4
BUILDX_VERSION=v0.19.3
mkdir -p /usr/local/lib/docker/cli-plugins

curl -SL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-${ARCH}" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

curl -SL "https://github.com/docker/buildx/releases/download/${BUILDX_VERSION}/buildx-${BUILDX_VERSION}.linux-${BUILDX_ARCH}" \
  -o /usr/local/lib/docker/cli-plugins/docker-buildx
chmod +x /usr/local/lib/docker/cli-plugins/docker-buildx

mkdir -p /opt/timeline
chown ec2-user:ec2-user /opt/timeline

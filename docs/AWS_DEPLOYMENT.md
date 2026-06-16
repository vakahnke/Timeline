# AWS Deployment (EC2 + Elastic IP + Cloudflare + HTTPS)

This deploys Timeline to a **single EC2 instance** — Postgres, gunicorn, and nginx (TLS via
Let's Encrypt) all in Docker on the box, behind an **elastic IP**, with DNS on **Cloudflare**.
Infrastructure is managed with **Terraform**. It's sized for a small team now and has a clear
path to ~3000 users (see [Scaling](#scaling-to-3000-users)).

```
Cloudflare DNS (timeline.vakahnke.com → Elastic IP)
        │  HTTPS
        ▼
   EC2 instance ── nginx (TLS, SPA + reverse proxy) ── gunicorn (Django) ── Postgres
                    certbot (auto-renew)              (containers, EBS volume)
```

## Prerequisites

- An **AWS account** and the AWS CLI configured (`aws configure`) — Terraform uses these creds.
- **Terraform ≥ 1.5** installed locally.
- An **SSH key pair** locally (e.g. `~/.ssh/id_ed25519[.pub]`).
- The **Cloudflare** domain (`timeline.vakahnke.com`) you control.

## 1. Provision the infrastructure (Terraform)

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars: set allowed_ssh_cidr to YOUR_IP/32, confirm region/instance_type/key path.
terraform init
terraform apply
```

Terraform creates a VPC + public subnet + internet gateway, a security group (SSH from your IP,
80/443 open), an **Amazon Linux 2023** instance (Docker + Compose + git installed via cloud-init),
a **gp3 EBS root volume** (encrypted), and an **elastic IP**. Outputs include the IP and next steps:

```bash
terraform output public_ip      # e.g. 52.x.x.x
terraform output next_steps
```

## 2. DNS (Cloudflare)

Create an **A record**: `timeline.vakahnke.com → <elastic IP>`.

> For the initial Let's Encrypt issuance, set the record to **DNS only** (grey cloud) so the
> ACME HTTP-01 challenge reaches the origin directly. Once HTTPS works you may switch the proxy
> **on** (orange cloud) — if you do, set Cloudflare's SSL/TLS mode to **Full (strict)** (it has a
> valid origin cert). Leaving it DNS-only is perfectly fine too.

## 3. Deploy the app

```bash
ssh ec2-user@<elastic IP>
cd /opt/timeline
git clone https://github.com/vakahnke/Timeline.git .     # (private repo: use a deploy key / PAT)
cp .env.example .env
```

Edit **`.env`** for production:

```bash
DJANGO_DEBUG=0
DJANGO_SECRET_KEY=<python -c "import secrets; print(secrets.token_urlsafe(64))">
POSTGRES_PASSWORD=<a strong password>
DATABASE_URL=postgres://timeline:<that password>@db:5432/timeline
DJANGO_ALLOWED_HOSTS=timeline.vakahnke.com
DJANGO_CSRF_TRUSTED_ORIGINS=https://timeline.vakahnke.com
DJANGO_CORS_ALLOWED_ORIGINS=
RUN_COLLECTSTATIC=1
DOMAIN=timeline.vakahnke.com
CERTBOT_EMAIL=you@example.com
WEB_CONCURRENCY=3
```

Obtain the TLS certificate, then bring the stack up:

```bash
./deploy/init-letsencrypt.sh                              # one-time: dummy cert → real cert
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec backend python manage.py createsuperuser
```

`migrate` + `collectstatic` run automatically on backend start. The app is now live at
**https://timeline.vakahnke.com**. (Tip: while testing certs, run `STAGING=1 ./deploy/init-letsencrypt.sh`
to avoid Let's Encrypt rate limits, then rerun without `STAGING`.)

## 4. Backups

```bash
# manual
./deploy/backup-db.sh
# daily cron at 03:00
( crontab -l 2>/dev/null; echo "0 3 * * * cd /opt/timeline && ./deploy/backup-db.sh >> backups/backup.log 2>&1" ) | crontab -
```

Dumps go to `backups/` (gzipped, rotated `BACKUP_KEEP_DAYS`). Set `S3_BACKUP_BUCKET` in `.env`
(and attach an S3 IAM role to the instance) to copy them off-box. Restore:

```bash
gunzip -c backups/<file>.sql.gz | docker compose -f docker-compose.prod.yml exec -T db psql -U timeline timeline
```

## Updating

```bash
cd /opt/timeline && git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Cert renewal is automatic (the `certbot` service renews; nginx picks it up).

---

## Sizing

The whole stack runs on one box (Postgres included). Approximate steady-state memory:

| Component | RAM |
|---|---|
| Amazon Linux 2023 | ~0.3 GB |
| Docker daemon | ~0.1 GB |
| PostgreSQL 16 | ~0.2 GB |
| gunicorn (3 workers × ~120 MB) | ~0.4 GB |
| nginx + certbot | ~0.05 GB |
| **Runtime total** | **~1.0–1.3 GB** |
| Building the frontend image on-box (vite/node, transient) | **+1–1.5 GB peak** |

**Recommendation (now — a team of 3, continued development):**

| Option | Instance | vCPU / RAM | Notes | ~On-demand* |
|---|---|---|---|---|
| **Recommended** | **t4g.medium** | 2 / 4 GiB | Comfortable runtime + on-box image builds + DB growth + headroom. **Default in Terraform.** | ~$24/mo |
| Budget | t4g.small | 2 / 2 GiB | Runs fine at runtime; add a **2 GB swapfile** to build images without OOM. | ~$12/mo |
| x86 | t3.medium / t3.small | same | Set `ami_architecture = "x86_64"`. Slightly pricier than Graviton. | ~$30 / $15 |

\* us-east-1, plus ~$2.4/mo for the 30 GiB gp3 volume. The elastic IP is free while attached.
**t4g (Graviton/ARM)** is the best value — every image here is multi-arch, so it just works.

Add swap on a small box:

```bash
sudo dd if=/dev/zero of=/swapfile bs=1M count=2048 && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Tune `WEB_CONCURRENCY` (gunicorn workers) to the box: a rule of thumb is `2 × vCPU + 1`, but it's
memory-bound (~120 MB/worker), so `3` is right for a 2-vCPU/4-GiB box.

## Scaling to ~3000 users

3000 *registered* users is light for this CRUD app — the concern is concurrency and resilience,
not raw compute. When you outgrow the single box, evolve it in this order (the Terraform VPC is the
base to build on):

1. **Postgres → Amazon RDS** (`db.t4g.medium`, then `db.m6g.large`): managed backups, point-in-time
   restore, easy vertical scaling. Point `DATABASE_URL` at the RDS endpoint and drop the `db`
   container. This alone removes the DB from the app box's memory budget.
2. **Build images in CI → push to ECR**; instances *pull* (no on-box builds → smaller app boxes).
3. **Scale the web tier** — either one larger instance (`m6g.large`/`xlarge`, 8/16 GiB, 8–16 gunicorn
   workers) **or** an **Application Load Balancer + Auto Scaling Group** of 2+ `t4g.large` app
   instances. Terminate TLS at the **ALB with an ACM cert** (then the box-level certbot/nginx-TLS is
   no longer needed — nginx just serves the SPA + proxies).
4. **CloudFront** in front of the SPA/assets for CDN caching (optional, helps global latency).
5. Consider **PgBouncer** and tuned `shared_buffers` / `max_connections` on the DB.

A reasonable 3000-user starting topology: **ALB + ASG (2× t4g.large) + RDS db.t4g.medium**, images
from ECR, TLS via ACM. Rough cost ~$200–400/mo depending on instance count and RDS size.

## Operational notes

- **Security group:** SSH is restricted to `allowed_ssh_cidr` (set it!); 80/443 are public. IMDSv2
  is enforced and the EBS root volume is encrypted.
- **Logs:** `docker compose -f docker-compose.prod.yml logs -f backend` (gunicorn logs to stdout).
- **Admin:** `https://timeline.vakahnke.com/admin/` (after `createsuperuser`).
- **Health check:** `GET /api/health/` returns `200` (`{"status":"ok"}`) — use it for monitoring or
  an ALB target-group health check later.
- **Secrets:** `.env` lives only on the box (gitignored). For a team, consider AWS SSM Parameter
  Store / Secrets Manager.

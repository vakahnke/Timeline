# Terraform — Timeline infrastructure

Provisions a single EC2 instance for the production stack: a minimal VPC + public subnet +
internet gateway, a security group (SSH restricted, 80/443 open), an Amazon Linux 2023
instance with Docker/Compose/git installed (cloud-init), an encrypted gp3 root volume, and
an **elastic IP**.

```bash
cp terraform.tfvars.example terraform.tfvars   # set allowed_ssh_cidr to YOUR_IP/32
terraform init
terraform apply
terraform output next_steps
```

DNS is **not** managed here (you use Cloudflare) — point an A record at `terraform output public_ip`.
Full walkthrough, TLS, backups, and **instance sizing**: see [`../docs/AWS_DEPLOYMENT.md`](../docs/AWS_DEPLOYMENT.md).

| Variable | Default | Notes |
|---|---|---|
| `region` | `us-east-1` | |
| `instance_type` | `t4g.medium` | ARM/Graviton (recommended). x86: `t3.medium` + `ami_architecture="x86_64"` |
| `root_volume_size` | `30` | GiB, gp3 |
| `ssh_public_key_path` | `~/.ssh/id_ed25519.pub` | installed for `ec2-user` |
| `allowed_ssh_cidr` | `0.0.0.0/0` | **set to your IP/32** |
| `domain` | `timeline.example.com` | used in outputs |

> State is local by default (`terraform.tfstate`, gitignored). For team use, configure an S3
> backend + DynamoDB lock.

variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Name prefix for resources and tags"
  type        = string
  default     = "timeline"
}

variable "instance_type" {
  description = "EC2 instance type. t4g.* = ARM/Graviton (cheaper, recommended); t3.* = x86."
  type        = string
  default     = "t4g.medium"
}

variable "ami_architecture" {
  description = "AMI architecture — must match instance_type (arm64 for t4g.*, x86_64 for t3.*)."
  type        = string
  default     = "arm64"
}

variable "root_volume_size" {
  description = "Root EBS volume size in GiB (OS + Docker images + Postgres data + room)."
  type        = number
  default     = 30
}

variable "ssh_public_key_path" {
  description = "Path to the SSH public key installed for ec2-user."
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
}

variable "allowed_ssh_cidr" {
  description = "CIDR allowed to SSH (port 22). SET THIS to your IP/32 — the default is open."
  type        = string
  default     = "0.0.0.0/0"
}

variable "domain" {
  description = "Domain the app is served at (DNS is managed in Cloudflare; used in outputs/tags)."
  type        = string
  default     = "timeline.example.com"
}

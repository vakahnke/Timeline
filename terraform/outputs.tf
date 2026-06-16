output "public_ip" {
  description = "Elastic IP — point the Cloudflare A record (timeline.vakahnke.com) at this."
  value       = aws_eip.app.public_ip
}

output "instance_id" {
  value = aws_instance.app.id
}

output "ssh" {
  description = "SSH into the box."
  value       = "ssh ec2-user@${aws_eip.app.public_ip}"
}

output "next_steps" {
  value = <<-EOT

    1. Cloudflare: create an A record  ${var.domain}  ->  ${aws_eip.app.public_ip}
       Set it "DNS only" (grey cloud) so Let's Encrypt can reach the origin.
    2. ssh ec2-user@${aws_eip.app.public_ip}
    3. cd /opt/timeline && git clone <repo> . && cp .env.example .env
       Edit .env: DJANGO_DEBUG=0, real DJANGO_SECRET_KEY, strong POSTGRES_PASSWORD,
       DOMAIN=${var.domain}, CERTBOT_EMAIL=you@example.com,
       DJANGO_ALLOWED_HOSTS=${var.domain}, DJANGO_CSRF_TRUSTED_ORIGINS=https://${var.domain}
    4. ./deploy/init-letsencrypt.sh
    5. docker compose -f docker-compose.prod.yml up -d --build
  EOT
}

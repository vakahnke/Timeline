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

output "ssm" {
  description = "Shell into the box via Session Manager — works without SSH / port 22."
  value       = "aws ssm start-session --target ${aws_instance.app.id}"
}

output "next_steps" {
  value = <<-EOT

    1. Cloudflare: create an A record  ${var.domain}  ->  ${aws_eip.app.public_ip}
       (proxied / orange-cloud), and set the zone SSL/TLS mode to "Full (strict)".
    2. Get on the box:  ssh ec2-user@${aws_eip.app.public_ip}
       (or, SSH-independent:  aws ssm start-session --target ${aws_instance.app.id})
    3. Ship the code to /opt/timeline and create .env: DJANGO_DEBUG=0, a strong
       DJANGO_SECRET_KEY + POSTGRES_PASSWORD, DOMAIN=${var.domain}, RUN_COLLECTSTATIC=1,
       DJANGO_ALLOWED_HOSTS=${var.domain}, DJANGO_CSRF_TRUSTED_ORIGINS=https://${var.domain}
    4. Create a Cloudflare Origin Certificate; save it to nginx/certs/origin.pem + origin.key.
    5. docker compose -f docker-compose.prod.yml up -d --build
  EOT
}

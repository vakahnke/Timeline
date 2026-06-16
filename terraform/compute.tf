resource "aws_key_pair" "this" {
  key_name   = "${var.project_name}-key"
  public_key = file(pathexpand(var.ssh_public_key_path))
  tags       = local.tags
}

resource "aws_instance" "app" {
  ami                    = nonsensitive(data.aws_ssm_parameter.al2023_ami.value)
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.web.id]
  key_name               = aws_key_pair.this.key_name
  user_data              = file("${path.module}/user_data.sh")
  iam_instance_profile   = aws_iam_instance_profile.ssm.name # SSM Session Manager access

  root_block_device {
    volume_size           = var.root_volume_size
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = true
  }

  metadata_options {
    http_tokens = "required" # IMDSv2 only
  }

  tags = merge(local.tags, { Name = "${var.project_name}-app" })

  # Protect the live instance: AMI drift (the SSM-published latest AL2023 id moves over time)
  # and user_data edits both force-replace an instance. Those changes are only meant to apply
  # to a *future* freshly-built box, never to silently destroy the running one. To rebuild
  # intentionally, `terraform taint aws_instance.app` (or -replace) then apply.
  lifecycle {
    ignore_changes = [ami, user_data]
  }
}

resource "aws_eip" "app" {
  domain   = "vpc"
  instance = aws_instance.app.id
  tags     = merge(local.tags, { Name = "${var.project_name}-eip" })
}

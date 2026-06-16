provider "aws" {
  region = var.region
}

# Latest Amazon Linux 2023 AMI for the chosen architecture (resolved at apply time).
data "aws_ssm_parameter" "al2023_ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-${var.ami_architecture}"
}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  tags = {
    Project   = var.project_name
    ManagedBy = "terraform"
  }
}

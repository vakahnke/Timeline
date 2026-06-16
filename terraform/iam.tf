# IAM role + instance profile so the SSM agent (already running on Amazon Linux 2023) can
# register the box with AWS Systems Manager. This enables Session Manager shell access
# (browser console or `aws ssm start-session`) that works independently of sshd / port 22 —
# a reliable fallback when SSH wedges.

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ssm" {
  name               = "${var.project_name}-ssm"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.ssm.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ssm" {
  name = "${var.project_name}-ssm"
  role = aws_iam_role.ssm.name
  tags = local.tags
}

data "aws_region" "current" {}

resource "aws_ecs_cluster" "main" {
  name = var.name_prefix
}

resource "aws_lb" "api" {
  name               = "${var.name_prefix}-api"
  load_balancer_type = "application"
  subnets            = var.public_subnet_ids
  security_groups    = [var.api_security_group_id]
}

resource "aws_lb_target_group" "api" {
  name        = "${var.name_prefix}-api"
  port        = var.api_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = data.aws_subnet.first.vpc_id

  health_check {
    path                = "/v1/health"
    matcher             = "200-399"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

data "aws_subnet" "first" {
  id = var.public_subnet_ids[0]
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

resource "aws_iam_role" "task_execution" {
  name = "${var.name_prefix}-task-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "task_execution" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "read_secrets" {
  role = aws_iam_role.task_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action   = ["secretsmanager:GetSecretValue"]
      Effect   = "Allow"
      Resource = var.secret_arn
    }]
  })
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.name_prefix}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.task_execution.arn

  container_definitions = jsonencode([{
    name      = "api"
    image     = var.api_image
    essential = true
    portMappings = [{
      containerPort = var.api_port
      protocol      = "tcp"
    }]
    environment = [
      { name = "PORT", value = tostring(var.api_port) },
      { name = "RATE_LIMIT_MAX", value = tostring(var.rate_limit_max) },
      { name = "RATE_LIMIT_WINDOW", value = tostring(var.rate_limit_window) }
    ]
    secrets = [
      { name = "DATABASE_URL", valueFrom = "${var.secret_arn}:DATABASE_URL::" },
      { name = "RESEND_API_KEY", valueFrom = "${var.secret_arn}:RESEND_API_KEY::" },
      { name = "AI_GATEWAY_BASE_URL", valueFrom = "${var.secret_arn}:AI_GATEWAY_BASE_URL::" },
      { name = "AI_GATEWAY_API_KEY", valueFrom = "${var.secret_arn}:AI_GATEWAY_API_KEY::" }
    ]
  }])
}

resource "aws_ecs_service" "api" {
  name            = "${var.name_prefix}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.public_subnet_ids
    security_groups  = [var.api_security_group_id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = var.api_port
  }

  depends_on = [aws_lb_listener.http]
}

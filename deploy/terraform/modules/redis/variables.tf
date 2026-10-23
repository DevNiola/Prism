variable "name" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "vpc_id" {
  type = string
}

variable "client_security_id" {
  type = string
}

variable "auth_token" {
  type      = string
  sensitive = true
}

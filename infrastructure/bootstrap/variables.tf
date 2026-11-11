variable "project_id" {
  type        = string
  description = "Dedicated GCP project ID"
}

variable "server_key_secret_id" {
  type    = string
  default = "ptcgl-wireguard-server-key"
}

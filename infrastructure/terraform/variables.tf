variable "project_id" {
  type        = string
  description = "GCP project ID"
}

variable "region" {
  type    = string
  default = "asia-southeast1"
}

variable "zone" {
  type    = string
  default = "asia-southeast1-b"
}

variable "instance_name" {
  type    = string
  default = "ptcgl-vpn"
}

variable "deployment_id" {
  type        = string
  default     = ""
  description = "Optional short suffix for parallel regional deployments"
  validation {
    condition     = var.deployment_id == "" || can(regex("^[a-z0-9-]{1,12}$", var.deployment_id))
    error_message = "deployment_id must be empty or 1-12 lowercase letters, digits, or hyphens"
  }
}

variable "machine_type" {
  type    = string
  default = "e2-micro"
}

variable "server_key_secret_id" {
  type        = string
  default     = "ptcgl-wireguard-server-key"
  description = "Secret Manager secret created by the bootstrap stack"
}

variable "wireguard_port" {
  type    = number
  default = 51820
}

variable "vpn_cidr" {
  type    = string
  default = "10.66.0.0/24"
}

variable "firewall_source_ranges" {
  type        = list(string)
  default     = ["0.0.0.0/0"]
  description = "Narrow this when the client public IP is stable"
}

variable "max_runtime_minutes" {
  type    = number
  default = 240
  validation {
    condition     = var.max_runtime_minutes >= 15 && var.max_runtime_minutes <= 1440
    error_message = "max_runtime_minutes must be 15..1440"
  }
}

variable "client_peers" {
  description = "One unique public key and tunnel IP per device"
  type = list(object({
    name       = string
    public_key = string
    address    = string
  }))
  default = []
  validation {
    condition     = length(distinct([for p in var.client_peers : p.public_key])) == length(var.client_peers)
    error_message = "Peer public keys must be unique"
  }
}

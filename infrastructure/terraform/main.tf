locals {
  deployment_suffix = var.deployment_id == "" ? "" : "-${var.deployment_id}"
  resource_name     = "${var.instance_name}${local.deployment_suffix}"
}

resource "google_compute_network" "vpn" {
  name                    = "${local.resource_name}-network"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "vpn" {
  name                     = "${local.resource_name}-subnet"
  ip_cidr_range            = "10.10.0.0/24"
  region                   = var.region
  network                  = google_compute_network.vpn.id
  private_ip_google_access = true
}

resource "google_compute_firewall" "vpn" {
  name          = "${local.resource_name}-wireguard"
  network       = google_compute_network.vpn.name
  direction     = "INGRESS"
  source_ranges = var.firewall_source_ranges
  target_tags   = ["wireguard-server"]

  allow {
    protocol = "udp"
    ports    = [tostring(var.wireguard_port)]
  }
}

data "google_service_account" "vpn" {
  account_id = "ptcgl-vpn-vm"
  project    = var.project_id
}

data "google_secret_manager_secret" "server_key" {
  secret_id = var.server_key_secret_id
  project   = var.project_id
}

resource "google_compute_instance" "vpn" {
  name           = local.resource_name
  zone           = var.zone
  machine_type   = var.machine_type
  can_ip_forward = true
  tags           = ["wireguard-server"]

  boot_disk {
    auto_delete = true
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = 10
      type  = "pd-standard"
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.vpn.id
    access_config {
      network_tier = "PREMIUM"
    }
  }

  service_account {
    email  = data.google_service_account.vpn.email
    scopes = ["https://www.googleapis.com/auth/cloud-platform"]
  }

  metadata = {
    enable-oslogin          = "TRUE"
    enable-guest-attributes = "TRUE"
    block-project-ssh-keys  = "TRUE"
    serial-port-enable      = "FALSE"
    startup-script = templatefile("${path.module}/templates/startup.sh.tftpl", {
      port                = var.wireguard_port
      server_address      = "${cidrhost(var.vpn_cidr, 1)}/${split("/", var.vpn_cidr)[1]}"
      max_runtime_minutes = var.max_runtime_minutes
      peers               = var.client_peers
      project_id          = var.project_id
      server_key_secret   = data.google_secret_manager_secret.server_key.secret_id
    })
  }

  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  scheduling {
    automatic_restart   = true
    on_host_maintenance = "MIGRATE"
    provisioning_model  = "STANDARD"
  }

  lifecycle {
    precondition {
      condition     = startswith(var.zone, var.region)
      error_message = "zone must belong to region"
    }
  }
}

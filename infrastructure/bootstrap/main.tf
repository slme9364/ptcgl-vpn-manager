resource "google_project_service" "secret_manager" {
  project            = var.project_id
  service            = "secretmanager.googleapis.com"
  disable_on_destroy = false
}

resource "google_service_account" "vpn" {
  project      = var.project_id
  account_id   = "ptcgl-vpn-vm"
  display_name = "PTCGL VPN VM"
}

resource "google_storage_bucket" "terraform_state" {
  project                     = var.project_id
  name                        = "${var.project_id}-tfstate"
  location                    = "US"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning { enabled = true }
  lifecycle_rule {
    condition { num_newer_versions = 10 }
    action { type = "Delete" }
  }

  lifecycle { prevent_destroy = true }
}

resource "google_secret_manager_secret" "server_key" {
  project             = var.project_id
  secret_id           = var.server_key_secret_id
  deletion_protection = true

  replication {
    auto {}
  }

  depends_on = [google_project_service.secret_manager]

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_secret_manager_secret_iam_member" "vm_access" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.server_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.vpn.email}"
}

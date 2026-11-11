output "server_key_secret_id" {
  value = google_secret_manager_secret.server_key.secret_id
}

output "vm_service_account" {
  value = google_service_account.vpn.email
}

output "terraform_state_bucket" {
  value = google_storage_bucket.terraform_state.name
}

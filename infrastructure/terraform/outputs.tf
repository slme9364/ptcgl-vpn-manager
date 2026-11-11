output "instance_name" {
  value = google_compute_instance.vpn.name
}

output "zone" {
  value = google_compute_instance.vpn.zone
}

output "external_ip" {
  value       = google_compute_instance.vpn.network_interface[0].access_config[0].nat_ip
  description = "Ephemeral; changes after stop/start"
}

output "server_public_key_command" {
  value = "gcloud compute ssh ${google_compute_instance.vpn.name} --zone ${var.zone} --command 'sudo cat /etc/wireguard/server.pub'"
}

output "client_peers" {
  value = var.client_peers
}

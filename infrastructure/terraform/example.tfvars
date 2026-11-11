project_id          = "your-project-id"
region              = "asia-southeast1"
zone                = "asia-southeast1-b"
max_runtime_minutes = 240
client_peers = [
  { name = "my-windows-pc", public_key = "REPLACE_WITH_CLIENT_PUBLIC_KEY", address = "10.66.0.2/32" }
]

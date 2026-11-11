#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 3 ]; then echo "Usage: $0 <server-public-key> <client-address/cidr> <output.conf>" >&2; exit 2; fi
command -v wg >/dev/null || { echo "wg is required" >&2; exit 1; }
server_public_key="$1"; client_address="$2"; output_file="$3"
if [ -e "$output_file" ]; then echo "Refusing to overwrite $output_file" >&2; exit 1; fi
private_key="$(wg genkey)"; public_key="$(printf '%s' "$private_key" | wg pubkey)"
umask 077
printf '[Interface]\nPrivateKey = %s\nAddress = %s\nDNS = 1.1.1.1\n\n[Peer]\nPublicKey = %s\nEndpoint = 0.0.0.0:51820\nAllowedIPs = 0.0.0.0/0, ::/0\nPersistentKeepalive = 25\n' "$private_key" "$client_address" "$server_public_key" > "$output_file"
printf 'Client public key (put in Terraform client_peers): %s\n' "$public_key"

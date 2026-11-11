import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';

export interface DeploymentInput {
  projectId: string; region: string; zone: string; deploymentId: string; instanceName: string;
  maxRuntimeMinutes: number; clientPublicKey: string; clientAddress: string;
}
export interface TerraformResult { code: number; output: string }
export interface DeploymentOutput { instanceName: string; zone: string; externalIp?: string }
interface Peer { name: string; public_key: string; address: string }

const safe = /^[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
export function validateDeployment(input: DeploymentInput) {
  if (!safe.test(input.projectId) || !safe.test(input.instanceName) || !/^[a-z0-9-]{1,12}$/.test(input.deploymentId)) throw new Error('Invalid deployment identifier');
  if (!/^[a-z]+-[a-z]+\d$/.test(input.region) || !input.zone.startsWith(`${input.region}-`)) throw new Error('Invalid region or zone');
  if (!/^[A-Za-z0-9+/]{43}=$/.test(input.clientPublicKey)) throw new Error('Invalid WireGuard client public key');
  if (!/^10\.66\.0\.\d{1,3}\/32$/.test(input.clientAddress)) throw new Error('Invalid client tunnel address');
  if (input.maxRuntimeMinutes < 15 || input.maxRuntimeMinutes > 1440) throw new Error('Invalid maximum runtime');
}

export class TerraformRunner {
  constructor(private readonly executable: string, private readonly sourceDir: string, private readonly dataRoot: string) {}
  private paths(id: string) { const root = join(this.dataRoot, id); return { root, data: join(root, '.terraform'), vars: join(root, 'deployment.tfvars.json'), plan: join(root, 'deployment.tfplan') }; }
  private async run(id: string, args: string[], onData?: (line: string) => void): Promise<TerraformResult> {
    const p = this.paths(id); await fs.mkdir(p.root, { recursive: true, mode: 0o700 });
    return new Promise((done, reject) => {
      const child = spawn(this.executable, [`-chdir=${resolve(this.sourceDir)}`, ...args], { windowsHide: true, env: { ...process.env, TF_IN_AUTOMATION: '1', TF_INPUT: '0', TF_DATA_DIR: p.data }, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = ''; const collect = (chunk: Buffer) => { const value = chunk.toString(); output += value; onData?.(value); };
      child.stdout.on('data', collect); child.stderr.on('data', collect); child.once('error', reject); child.once('close', code => done({ code: code ?? 1, output }));
    });
  }
  private async prepare(input: DeploymentInput, onData?: (line: string) => void) {
    validateDeployment(input); const p = this.paths(input.deploymentId); await fs.mkdir(p.root, { recursive: true, mode: 0o700 });
    const init = await this.run(input.deploymentId, ['init', '-reconfigure', `-backend-config=bucket=${input.projectId}-tfstate`, `-backend-config=prefix=ptcgl-vpn/${input.deploymentId}`, '-no-color'], onData);
    if (init.code !== 0) throw new Error(`Terraform init failed\n${init.output}`);
    const existingOutput = await this.run(input.deploymentId, ['output', '-json', 'client_peers'], onData);
    let peers: Peer[] = [];
    if (existingOutput.code === 0) { try { peers = JSON.parse(existingOutput.output) as Peer[]; } catch { peers = []; } }
    const current = peers.find(peer => peer.public_key === input.clientPublicKey);
    let clientAddress = current?.address ?? input.clientAddress;
    if (!current && peers.some(peer => peer.address === clientAddress)) {
      const used = new Set(peers.map(peer => peer.address));
      const host = Array.from({ length: 253 }, (_, i) => i + 2).find(value => !used.has(`10.66.0.${value}/32`));
      if (!host) throw new Error('No free WireGuard client address'); clientAddress = `10.66.0.${host}/32`;
    }
    const merged = [...peers.filter(peer => peer.public_key !== input.clientPublicKey), { name: `${process.platform}-${input.deploymentId}-${input.clientPublicKey.slice(0, 6)}`, public_key: input.clientPublicKey, address: clientAddress }];
    await fs.writeFile(p.vars, JSON.stringify({ project_id: input.projectId, region: input.region, zone: input.zone, deployment_id: input.deploymentId, instance_name: input.instanceName, max_runtime_minutes: input.maxRuntimeMinutes, client_peers: merged }, null, 2), { mode: 0o600 });
    return { ...p, clientAddress };
  }
  async plan(input: DeploymentInput, onData?: (line: string) => void) {
    const p = await this.prepare(input, onData); const result = await this.run(input.deploymentId, ['plan', `-var-file=${p.vars}`, `-out=${p.plan}`, '-no-color'], onData);
    if (result.code !== 0) throw new Error(`Terraform plan failed\n${result.output}`);
    const summary = result.output.match(/Plan: (\d+) to add, (\d+) to change, (\d+) to destroy\./);
    return { output: result.output, add: Number(summary?.[1] ?? 0), change: Number(summary?.[2] ?? 0), destroy: Number(summary?.[3] ?? 0), clientAddress: p.clientAddress };
  }
  async apply(input: DeploymentInput, onData?: (line: string) => void) {
    const p = this.paths(input.deploymentId); const result = await this.run(input.deploymentId, ['apply', '-auto-approve', '-no-color', p.plan], onData);
    if (result.code !== 0) throw new Error(`Terraform apply failed\n${result.output}`);
    const output = await this.run(input.deploymentId, ['output', '-json'], onData); if (output.code !== 0) throw new Error(`Terraform output failed\n${output.output}`);
    const values = JSON.parse(output.output) as Record<string, { value: string }>;
    return { instanceName: values.instance_name?.value ?? `${input.instanceName}-${input.deploymentId}`, zone: values.zone?.value ?? input.zone, externalIp: values.external_ip?.value } satisfies DeploymentOutput;
  }
  async destroy(input: DeploymentInput, onData?: (line: string) => void) {
    const p = await this.prepare(input, onData); const result = await this.run(input.deploymentId, ['destroy', '-auto-approve', '-no-color', `-var-file=${p.vars}`], onData);
    if (result.code !== 0) throw new Error(`Terraform destroy failed\n${result.output}`);
  }
}

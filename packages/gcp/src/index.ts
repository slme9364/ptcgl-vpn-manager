import { InstancesClient, ZoneOperationsClient } from '@google-cloud/compute';
import type { VmStatus } from '@ptcgl/core';
export * from './terraform';

export interface GcpTarget { projectId: string; zone: string; instanceName: string }
export function normalizeVmStatus(status: string | null | undefined): VmStatus {
  if (status === 'RUNNING') return 'RUNNING';
  if (status === 'TERMINATED' || status === 'STOPPED') return 'STOPPED';
  if (status === 'PROVISIONING' || status === 'STAGING' || status === 'STARTING') return 'STARTING';
  if (status === 'STOPPING') return 'STOPPING';
  return 'UNKNOWN';
}

export class GcpVmClient {
  constructor(private readonly instances = new InstancesClient(), private readonly operations = new ZoneOperationsClient()) {}
  async get(target: GcpTarget): Promise<{ status: VmStatus; externalIp?: string }> {
    const [vm] = await this.instances.get({ project: target.projectId, zone: target.zone, instance: target.instanceName });
    const externalIp = vm.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP ?? undefined;
    return { status: normalizeVmStatus(vm.status), externalIp };
  }
  async start(target: GcpTarget) { const [op] = await this.instances.start({ project: target.projectId, zone: target.zone, instance: target.instanceName }); await this.wait(target, op.name!); }
  async stop(target: GcpTarget) { const current = await this.get(target); if (current.status === 'STOPPED') return; const [op] = await this.instances.stop({ project: target.projectId, zone: target.zone, instance: target.instanceName }); await this.wait(target, op.name!); }
  private async wait(target: GcpTarget, operation: string) {
    await this.operations.wait({ project: target.projectId, zone: target.zone, operation });
  }
}

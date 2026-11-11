export type VmStatus = 'RUNNING' | 'STOPPED' | 'STARTING' | 'STOPPING' | 'UNKNOWN';
export type VpnStatus = 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING' | 'DISCONNECTING' | 'ERROR';
export type VpnMode = 'full-tunnel' | 'destination-split' | 'windows-app-split';
export type InfraStatus = 'IDLE' | 'PLANNING' | 'PLANNED' | 'APPLYING' | 'READY' | 'DESTROYING' | 'ERROR';

export interface RegionOption { region: string; zone: string; label: string; deploymentId: string }
export const REGIONS: RegionOption[] = [
  { region: 'asia-southeast1', zone: 'asia-southeast1-b', label: 'Singapore', deploymentId: 'sg' },
  { region: 'us-west1', zone: 'us-west1-b', label: 'Oregon, USA', deploymentId: 'usw1' },
  { region: 'us-central1', zone: 'us-central1-a', label: 'Iowa, USA', deploymentId: 'usc1' },
  { region: 'us-east1', zone: 'us-east1-b', label: 'South Carolina, USA', deploymentId: 'use1' }
];

export interface AppSettings {
  projectId: string;
  zone: string;
  instanceName: string;
  region: string;
  ptcglExecutable: string;
  wireGuardConfigPath: string;
  vpnClient: 'wireguard' | 'wiresock';
  vpnMode: VpnMode;
  maxRuntimeMinutes: number;
  autoStop: boolean;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  terraformExecutable: string;
  infrastructurePath: string;
  clientPublicKey: string;
  clientAddress: string;
}

export interface DashboardState {
  vmStatus: VmStatus;
  vpnStatus: VpnStatus;
  externalIp?: string;
  startedAt?: string;
  region: string;
  estimatedMonthlyCost: number;
  busy: boolean;
  message?: string;
  infraStatus?: InfraStatus;
  infraLog?: string;
}

export interface PriceModel {
  vmHourlyUsd: number;
  externalIpv4HourlyUsd: number;
  diskGbMonthlyUsd: number;
  diskGb: number;
  egressGbUsd: number;
}

export function estimateCost(model: PriceModel, vmHours: number, ipv4Hours: number, egressGb = 0) {
  const vm = model.vmHourlyUsd * vmHours;
  const ipv4 = model.externalIpv4HourlyUsd * ipv4Hours;
  const disk = model.diskGbMonthlyUsd * model.diskGb;
  const network = model.egressGbUsd * egressGb;
  return { vm, ipv4, disk, network, total: vm + ipv4 + disk + network };
}

export const DEFAULT_SETTINGS: AppSettings = {
  projectId: '', zone: 'asia-southeast1-b', instanceName: 'ptcgl-vpn', region: 'asia-southeast1',
  ptcglExecutable: '', wireGuardConfigPath: '', vpnClient: 'wireguard', vpnMode: 'full-tunnel',
  maxRuntimeMinutes: 240, autoStop: true, logLevel: 'info', terraformExecutable: 'terraform',
  infrastructurePath: '', clientPublicKey: '', clientAddress: '10.66.0.2/32'
};

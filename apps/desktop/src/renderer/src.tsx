import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { REGIONS, type AppSettings, type DashboardState } from '@ptcgl/core';
import './style.css';

const initial: DashboardState = { vmStatus: 'UNKNOWN', vpnStatus: 'DISCONNECTED', region: '', estimatedMonthlyCost: 0, busy: false };
type UpdateState = Awaited<ReturnType<typeof window.ptcgl.getUpdateState>>;
function App() {
  const [state, setState] = useState(initial); const [settings, setSettings] = useState<AppSettings>(); const [showSettings, setShowSettings] = useState(false); const [error, setError] = useState('');
  const [deploymentId, setDeploymentId] = useState('sg');
  const [update, setUpdate] = useState<UpdateState>({ status: 'IDLE', currentVersion: '0.1.0' });
  useEffect(() => { void window.ptcgl.getState().then(setState); void window.ptcgl.getSettings().then(setSettings); void window.ptcgl.getUpdateState().then(setUpdate); const offState = window.ptcgl.onState(setState); const offUpdate = window.ptcgl.onUpdate(setUpdate); return () => { offState(); offUpdate(); }; }, []);
  const run = (fn: () => Promise<unknown>) => { setError(''); void fn().catch(e => setError(e instanceof Error ? e.message : String(e))); };
  return <main>
    <header><div><span className="eyebrow">ON-DEMAND PRIVATE NETWORK</span><h1>PTCGL VPN Manager</h1></div><button className="ghost" onClick={() => setShowSettings(!showSettings)}>設定</button></header>
    {error && <div className="alert">{error}</div>}{state.message && <div className="notice">{state.message}</div>}
    <section className="grid">
      <Card label="GCP VM" value={state.vmStatus} active={state.vmStatus === 'RUNNING'} />
      <Card label="VPN" value={state.vpnStatus} active={state.vpnStatus === 'CONNECTED'} />
      <Card label="リージョン" value={state.region || '未設定'} />
      <Card label="VMの外部 IPv4" value={state.externalIp || '—'} mono />
    </section>
    {state.vpnHealth && <p className="notice">WireGuard最終通信: {state.vpnHealth.lastHandshakeAt ? new Date(state.vpnHealth.lastHandshakeAt).toLocaleTimeString('ja-JP') : '未確認'} · 受信 {state.vpnHealth.receivedBytes.toLocaleString()} B · 送信 {state.vpnHealth.sentBytes.toLocaleString()} B</p>}
    <section className="session"><div><span className="eyebrow">SESSION</span><h2>{state.busy ? '処理中…' : state.vpnStatus === 'CONNECTED' ? 'VPN接続中' : '準備完了'}</h2><p>実請求とは異なる概算です。VM停止前に他端末の利用状況を確認してください。</p></div><button className="primary" disabled={state.busy} onClick={() => run(window.ptcgl.startSession)}>PTCGLを起動</button></section>
    <div className="actions"><button disabled={state.busy} onClick={() => run(window.ptcgl.refresh)}>状態更新</button><button disabled={state.busy || state.vpnStatus === 'CONNECTED'} onClick={() => run(window.ptcgl.connect)}>VPN接続</button><button disabled={state.busy || state.vpnStatus !== 'CONNECTED'} onClick={() => run(window.ptcgl.disconnect)}>VPN切断</button><button className="danger" disabled={state.busy} onClick={() => confirm('他端末が利用していないことを確認しましたか？') && run(window.ptcgl.stopVm)}>VM停止</button></div>
    <section className="settings infrastructure"><div className="infraHeader"><div><span className="eyebrow">INFRASTRUCTURE</span><h2>リージョン環境</h2></div><span className="badge">{state.infraStatus ?? 'IDLE'}</span></div>
      <div className="infraControls"><label>デプロイ先<select value={deploymentId} onChange={e => setDeploymentId(e.target.value)}>{REGIONS.map(r => <option key={r.deploymentId} value={r.deploymentId}>{r.label} — {r.region}</option>)}</select></label>
        <button disabled={state.busy} onClick={() => run(() => window.ptcgl.planInfrastructure(deploymentId))}>Plan</button>
        <button className="primary" disabled={state.busy || state.infraStatus !== 'PLANNED'} onClick={() => confirm('planの内容を確認し、課金リソースを作成・変更しますか？') && run(() => window.ptcgl.applyInfrastructure(deploymentId))}>Apply</button>
        <button className="danger" disabled={state.busy} onClick={() => confirm('このリージョン環境のVM、ディスク、ネットワークを削除します。永続鍵は残ります。続けますか？') && run(() => window.ptcgl.destroyInfrastructure(deploymentId))}>環境削除</button>
      </div>{state.infraLog && <details><summary>Terraformログ</summary><pre>{state.infraLog}</pre></details>}
    </section>
    <section className="settings updater"><div><span className="eyebrow">APPLICATION UPDATE</span><h2>アプリ更新</h2><p>現在 v{update.currentVersion} · {update.message ?? 'GitHub Releaseから更新を確認します'}</p></div><div className="actions">
      <button disabled={update.status === 'CHECKING' || update.status === 'DOWNLOADING'} onClick={() => run(window.ptcgl.checkForUpdates)}>更新確認</button>
      {update.status === 'AVAILABLE' && <button className="primary" onClick={() => run(window.ptcgl.downloadUpdate)}>ダウンロード</button>}
      {update.status === 'READY' && <button className="primary" onClick={() => run(window.ptcgl.installUpdate)}>再起動して更新</button>}
    </div></section>
    {showSettings && settings && <Settings value={settings} onChange={setSettings} onSave={() => run(async () => { const saved = await window.ptcgl.saveSettings(settings); setSettings(saved); setShowSettings(false); })} />}
  </main>;
}
function Card({ label, value, active, mono }: { label: string; value: string; active?: boolean; mono?: boolean }) { return <article className="card"><span>{label}</span><strong className={mono ? 'mono' : ''}><i className={active ? 'on' : ''}/>{value}</strong></article>; }
function Settings({ value, onChange, onSave }: { value: AppSettings; onChange(v: AppSettings): void; onSave(): void }) {
 const field = (key: keyof AppSettings, label: string, type = 'text') => <label>{label}<input type={type} value={String(value[key])} onChange={e => onChange({ ...value, [key]: type === 'number' ? Number(e.target.value) : e.target.value })}/></label>;
 return <section className="settings"><h2>設定</h2><button onClick={() => void window.ptcgl.detectPtcgl().then(path => path && onChange({...value,ptcglExecutable:path}))}>PTCGLを自動検出</button><div className="form">{field('projectId','GCP Project ID')}{field('instanceName','VM名')}{field('region','リージョン')}{field('zone','ゾーン')}{field('ptcglExecutable','PTCGL実行ファイル')}{field('wireGuardConfigPath','WireGuard設定')}{field('clientPublicKey','この端末の公開鍵')}{field('clientAddress','トンネルアドレス')}{field('terraformExecutable','Terraform実行ファイル')}{field('infrastructurePath','Terraform構成パス（通常は空）')}{field('maxRuntimeMinutes','最大稼働時間（分）','number')}<label>VPNクライアント<select value={value.vpnClient} onChange={e => onChange({...value,vpnClient:e.target.value as AppSettings['vpnClient']})}><option value="wireguard">WireGuard公式</option><option value="wiresock">WireSock（Windowsアプリ分離）</option></select></label></div><button className="primary" onClick={onSave}>保存</button></section>;
}
createRoot(document.getElementById('root')!).render(<App/>);

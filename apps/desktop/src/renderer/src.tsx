import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { REGIONS, type AppSettings, type DashboardState, type DiagnosticReport } from '@ptcgl/core';
import './style.css';

const initial: DashboardState = { vmStatus: 'UNKNOWN', vpnStatus: 'DISCONNECTED', region: '', estimatedMonthlyCost: 0, busy: false };
type UpdateState = Awaited<ReturnType<typeof window.ptcgl.getUpdateState>>;
function App() {
  const [state, setState] = useState(initial); const [settings, setSettings] = useState<AppSettings>(); const [showSettings, setShowSettings] = useState(false); const [error, setError] = useState('');
  const [report, setReport] = useState<DiagnosticReport>(); const [copied, setCopied] = useState(false);
  const [deploymentId, setDeploymentId] = useState('sg');
  const [update, setUpdate] = useState<UpdateState>({ status: 'IDLE', currentVersion: '0.2.0' });
  useEffect(() => { void window.ptcgl.getState().then(setState); void window.ptcgl.getSettings().then(setSettings); void window.ptcgl.getUpdateState().then(setUpdate); const offState = window.ptcgl.onState(setState); const offUpdate = window.ptcgl.onUpdate(setUpdate); return () => { offState(); offUpdate(); }; }, []);
  const run = (fn: () => Promise<unknown>) => { setError(''); void fn().catch(e => setError(e instanceof Error ? e.message : String(e))); };
  return <main>
    <header><div><span className="eyebrow">PLAY ON YOUR TERMS</span><h1>PTCGL VPN Manager</h1></div><button className="ghost" onClick={() => run(async () => { setSettings(await window.ptcgl.getSettings()); setShowSettings(!showSettings); })}>設定</button></header>
    {error && <div className="alert">{error}</div>}{state.message && <div className="notice">{state.message}</div>}
    <section className="grid">
      <Card label="GCP VM" value={({UNKNOWN:'未確認',RUNNING:'稼働中',STOPPED:'停止中',STARTING:'起動中',STOPPING:'停止中',ERROR:'エラー'} as Record<string,string>)[state.vmStatus] || state.vmStatus} active={state.vmStatus === 'RUNNING'} />
      <Card label={state.vpnScope === 'ptcgl' ? 'VPN（PTCGL専用）' : 'VPN'} value={({DISCONNECTED:'未接続',CONNECTED:'接続中',CONNECTING:'接続処理中',DISCONNECTING:'切断処理中',ERROR:'要確認'} as Record<string,string>)[state.vpnStatus] || state.vpnStatus} active={state.vpnStatus === 'CONNECTED'} />
      <Card label="PTCGL / 更新ツール" value={state.gameRunning === undefined ? '未確認' : state.gameRunning ? '起動中' : '終了'} active={state.gameRunning} />
      <Card label="VMの外部 IPv4" value={state.externalIp || '—'} mono />
    </section>
    {state.vpnScope === 'ptcgl' && <p className="notice">PTCGLのみVPN / 最終通信: {state.vpnHandshakeAt ? new Date(state.vpnHandshakeAt).toLocaleTimeString('ja-JP') : '未確認'}。Chromeなど他のアプリは通常回線を使用します。</p>}
    {state.vpnHealth && <p className="notice">WireGuard最終通信: {state.vpnHealth.lastHandshakeAt ? new Date(state.vpnHealth.lastHandshakeAt).toLocaleTimeString('ja-JP') : '未確認'} · 受信 {state.vpnHealth.receivedBytes.toLocaleString()} B · 送信 {state.vpnHealth.sentBytes.toLocaleString()} B</p>}
    <section className="session"><div><span className="eyebrow">GAME SESSION</span><h2>{state.busy ? '処理中…' : 'PTCGLを開く'}</h2><p>ログインが繰り返されるときは通常回線でお試しください。</p><p>{settings?.vpnClient === 'wiresock' ? 'VPNの対象はPTCGLのみです。' : 'WireGuardでは端末全体がVPNの対象です。'} 起動済みなら二重に開きません。</p></div><div className="launch"><button disabled={state.busy} onClick={() => run(window.ptcgl.startNormally)}>通常回線で開く<span>ログイン用 · ManagerのVPNを切断</span></button><button className="primary" disabled={state.busy} onClick={() => run(window.ptcgl.startSession)}>VPNで開く<span>VMを確認して接続</span></button></div></section>
    <div className="actions"><button disabled={state.busy} onClick={() => run(window.ptcgl.refresh)}>状態更新</button><button disabled={state.busy || state.vpnStatus === 'CONNECTED'} onClick={() => run(window.ptcgl.connect)}>VPN接続</button><button disabled={state.busy} onClick={() => run(window.ptcgl.disconnect)}>VPN切断</button><button className="danger" disabled={state.busy} onClick={() => confirm('他端末が利用していないことを確認しましたか？ VMを停止します。') && run(window.ptcgl.stopVm)}>VM停止</button></div>
    {showSettings && settings && <Settings value={settings} locked={state.vpnStatus !== 'DISCONNECTED'} busy={state.busy} run={run} onChange={setSettings} onSave={() => run(async () => { setSettings(await window.ptcgl.saveSettings(settings)); setShowSettings(false); })} />}
    <section className="settings"><div className="infraHeader"><div><span className="eyebrow">CONNECTION CHECK</span><h2>接続診断</h2><p>設定とクラウドへの読み取りを確認します。VMの起動・停止やVPN接続は行いません。</p></div><div className="actions"><button disabled={state.busy} onClick={() => run(async () => { setCopied(false); setReport(await window.ptcgl.diagnose()); })}>診断する</button><button disabled={state.busy} onClick={() => run(async () => { await window.ptcgl.copyDiagnostics(); setCopied(true); })}>{copied ? 'コピーしました' : '診断をコピー'}</button></div></div>
      {report && <><p>確認時刻 {new Date(report.checkedAt).toLocaleString('ja-JP')}</p><div className="checks">{report.checks.map(c => <article key={c.id} className={'check '+c.status}><strong>{c.status === 'ok' ? '✓' : c.status === 'error' ? '!' : '△'} {c.title}</strong><p>{c.detail}</p></article>)}</div></>}
      <p className="hint">コピーには鍵・トークン・プロジェクト名などを含めないよう除去処理を行います。共有前に内容をご確認ください。</p>
    </section>
    <details className="settings"><summary>最近の操作</summary><ol className="activity">{[...(state.activities ?? [])].reverse().map(item => <li key={item.id} className={item.level}><time>{new Date(item.at).toLocaleTimeString('ja-JP')}</time> {item.title}{item.detail && <p>{item.detail}</p>}</li>)}</ol>{!state.activities?.length && <p>まだ操作はありません。</p>}</details>
    <details className="advanced"><summary>リージョン・クラウド環境の管理</summary>
    <section className="settings infrastructure"><div className="infraHeader"><div><span className="eyebrow">INFRASTRUCTURE</span><h2>リージョン環境</h2></div><span className="badge">{state.infraStatus ?? 'IDLE'}</span></div>
      <div className="infraControls"><label>デプロイ先<select value={deploymentId} onChange={e => setDeploymentId(e.target.value)}>{REGIONS.map(r => <option key={r.deploymentId} value={r.deploymentId}>{r.label} — {r.region}</option>)}</select></label>
        <button disabled={state.busy} onClick={() => run(() => window.ptcgl.planInfrastructure(deploymentId))}>Plan</button>
        <button className="primary" disabled={state.busy || state.infraStatus !== 'PLANNED'} onClick={() => confirm('planの内容を確認し、課金リソースを作成・変更しますか？') && run(() => window.ptcgl.applyInfrastructure(deploymentId))}>Apply</button>
        <button className="danger" disabled={state.busy} onClick={() => confirm('このリージョン環境のVM、ディスク、ネットワークを削除します。永続鍵は残ります。続けますか？') && run(() => window.ptcgl.destroyInfrastructure(deploymentId))}>環境削除</button>
      </div>{state.infraLog && <details><summary>Terraformログ</summary><pre>{state.infraLog}</pre></details>}
    </section>
    </details>
    <section className="settings updater"><div><span className="eyebrow">APPLICATION UPDATE</span><h2>アプリ更新</h2><p>現在 v{update.currentVersion} · {update.message ?? 'ゲーム終了・VPN切断後に更新できます'}</p></div><div className="actions">
      <button disabled={update.status === 'CHECKING' || update.status === 'DOWNLOADING'} onClick={() => run(window.ptcgl.checkForUpdates)}>更新確認</button>
      {update.status === 'AVAILABLE' && <button className="primary" onClick={() => run(window.ptcgl.downloadUpdate)}>ダウンロード</button>}
      {update.status === 'READY' && <button className="primary" disabled={state.busy || state.gameRunning !== false || state.vpnStatus !== 'DISCONNECTED'} onClick={() => run(window.ptcgl.installUpdate)}>再起動して更新</button>}
    </div></section>
  </main>;
}
function Card({ label, value, active, mono }: { label: string; value: string; active?: boolean; mono?: boolean }) { return <article className="card"><span>{label}</span><strong className={mono ? 'mono' : ''}><i className={active ? 'on' : ''}/>{value}</strong></article>; }
function Settings({ value, onChange, onSave, locked, busy, run }: { value: AppSettings; onChange(v: AppSettings): void; onSave(): void; locked: boolean; busy: boolean; run(fn: () => Promise<unknown>): void }) {
 const field = (key: keyof AppSettings, label: string, type = 'text') => <label>{label}<input type={type} value={String(value[key] ?? '')} onChange={e => onChange({ ...value, [key]: type === 'number' ? Number(e.target.value) : e.target.value })}/></label>;
 const pick = (kind: 'game' | 'config') => run(async () => { const path = await window.ptcgl.pickPath(kind); if (path) onChange({...value,[kind === 'game' ? 'ptcglExecutable' : 'wireGuardConfigPath']:path}); });
 return <section className="settings"><h2>設定</h2>{locked && <p>接続先の変更はVPN切断後に行えます。</p>}<fieldset disabled={locked || busy}>
 <div className="form">{field('ptcglExecutable','PTCGL実行ファイル')}<div className="actions"><button onClick={() => pick('game')}>ファイルを選択</button><button onClick={() => run(async () => { const path = await window.ptcgl.detectPtcgl(); if (!path) throw new Error('見つかりませんでした。ファイルを選択してください。'); onChange({...value,ptcglExecutable:path}); })}>自動検出</button></div>{field('wireGuardConfigPath','WireGuard設定ファイル (.conf)')}<button onClick={() => pick('config')}>設定ファイルを選択</button>
 <label>VPNの対象<select value={value.vpnClient} onChange={e => { const vpnClient=e.target.value as AppSettings['vpnClient']; onChange({...value,vpnClient,vpnMode:vpnClient === 'wiresock' ? 'windows-app-split' : 'full-tunnel'}); }}><option value="wiresock">PTCGLのみ（Windows / WireSock CLI）</option><option value="wireguard">端末全体（WireGuard）</option></select></label></div>
 <details><summary>詳細設定 / GCP接続先</summary><div className="form">{field('projectId','GCP Project ID')}{field('instanceName','VM名')}{field('region','リージョン')}{field('zone','ゾーン')}{field('clientPublicKey','この端末の公開鍵')}{field('clientAddress','トンネルアドレス')}{field('terraformExecutable','Terraform実行ファイル')}{field('infrastructurePath','Terraform構成パス（通常は空）')}{field('maxRuntimeMinutes','最大稼働時間（分）','number')}</div></details></fieldset>
 <label className="checkbox"><input type="checkbox" checked={value.disconnectOnGameExit !== false} onChange={e => onChange({...value,disconnectOnGameExit:e.target.checked})}/>ゲーム終了後にVPNを自動切断する（VM停止は別操作）</label><button disabled={busy} className="primary" onClick={onSave}>保存</button></section>;
}
createRoot(document.getElementById('root')!).render(<App/>);

import { Router } from 'express';
import { getBotRuntimeSnapshot } from '../bot';
import { START_BOT, OBSIDIAN_HEADLESS_ENABLED } from '../config';
import { getAutomationRuntimeSnapshot, isAutomationEnabled } from '../services/automationBot';
import { getExternalAdapterStatus } from '../services/tools/externalAdapterRegistry';
import { getDelegationStatus } from '../services/automation/n8nDelegationService';
import { getLastMigrationValidation } from '../utils/migrationRegistry';
import { getObsidianVaultRoot } from '../utils/obsidianEnv';
import { getObsidianAdapterRuntimeStatus } from '../services/obsidian/router';
import { existsSync, readdirSync } from 'node:fs';

/* ─── HTML Template Helpers ──────────────────────────────────────── */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const dot = (ok: boolean) => ok
  ? '<span class="dot green"></span>'
  : '<span class="dot red"></span>';

const badge = (label: string, ok: boolean) =>
  `<span class="badge ${ok ? 'bg-green' : 'bg-red'}">${esc(label)}</span>`;

const formatUptime = (sec: number) => {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

/* ─── Vault stats ────────────────────────────────────────────────── */

const getVaultStats = () => {
  const vaultPath = getObsidianVaultRoot();
  if (!vaultPath) return null;
  const vaultExists = existsSync(vaultPath);
  let fileCount = 0;
  if (vaultExists) {
    try {
      const countMd = (dir: string): number => {
        let n = 0;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) n += countMd(`${dir}/${entry.name}`);
          else if (entry.isFile() && entry.name.endsWith('.md')) n++;
        }
        return n;
      };
      fileCount = countMd(vaultPath);
    } catch { /* non-critical */ }
  }
  return {
    vaultPath,
    vaultReady: vaultExists && fileCount > 0,
    headlessEnabled: OBSIDIAN_HEADLESS_ENABLED,
    fileCount,
  };
};

/* ─── CSS ────────────────────────────────────────────────────────── */

const CSS = `
<style>
  :root {
    --bg: #0d1117; --surface: #161b22; --border: #30363d;
    --text: #e6edf3; --muted: #8b949e; --green: #3fb950;
    --red: #f85149; --yellow: #d29922; --blue: #58a6ff;
    --font: 'Segoe UI', -apple-system, system-ui, sans-serif;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: var(--bg); color: var(--text); font-family: var(--font); padding: 24px; }
  h1 { font-size: 20px; margin-bottom: 8px; }
  .subtitle { color: var(--muted); font-size: 13px; margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .card h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .dot.green { background: var(--green); box-shadow: 0 0 6px var(--green); }
  .dot.red { background: var(--red); box-shadow: 0 0 6px var(--red); }
  .dot.yellow { background: var(--yellow); box-shadow: 0 0 6px var(--yellow); }
  .kv { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; border-bottom: 1px solid var(--border); }
  .kv:last-child { border-bottom: none; }
  .kv .k { color: var(--muted); }
  .kv .v { font-weight: 500; }
  .badge { font-size: 11px; padding: 2px 8px; border-radius: 12px; font-weight: 600; }
  .bg-green { background: rgba(63,185,80,0.15); color: var(--green); }
  .bg-red { background: rgba(248,81,73,0.15); color: var(--red); }
  .bg-yellow { background: rgba(210,153,34,0.15); color: var(--yellow); }
  .bg-blue { background: rgba(88,166,255,0.15); color: var(--blue); }
  .adapter-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
  .adapter-row:last-child { border-bottom: none; }
  .adapter-name { font-weight: 600; min-width: 100px; }
  .caps { color: var(--muted); font-size: 11px; }
  .bar-container { background: var(--border); border-radius: 4px; height: 6px; flex: 1; }
  .bar-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
  .bar-fill.green { background: var(--green); }
  .ts { color: var(--muted); font-size: 11px; text-align: right; margin-top: 16px; }
  .refresh-btn { background: var(--surface); border: 1px solid var(--border); color: var(--blue); padding: 4px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; margin-left: auto; }
  .refresh-btn:hover { background: var(--border); }
  .header { display: flex; align-items: center; margin-bottom: 24px; }
  .header h1 { margin-bottom: 0; }
  .status-pill { margin-left: 12px; font-size: 12px; padding: 3px 10px; border-radius: 12px; font-weight: 600; }
  .card-wide { grid-column: span 2; }
  .cap-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 4px; margin-top: 8px; }
  .cap-item { display: flex; align-items: center; gap: 6px; font-size: 12px; padding: 4px 8px; background: var(--bg); border-radius: 4px; }
  .cap-item .cap-name { color: var(--muted); }
  .cap-item .cap-handler { font-weight: 600; }
  .section-label { font-size: 12px; color: var(--muted); margin-top: 12px; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.3px; }
  .obs-adapter-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12px; }
  .obs-adapter-name { font-weight: 600; min-width: 90px; }
  .obs-caps-list { color: var(--muted); font-size: 11px; }
  @media (max-width: 768px) { .card-wide { grid-column: span 1; } }
</style>`;

/* ─── Router ─────────────────────────────────────────────────────── */

export function createDashboardRouter(): Router {
  const router = Router();

  router.get('/dashboard', async (_req, res) => {
    const uptimeSec = Math.floor(process.uptime());
    const bot = getBotRuntimeSnapshot();
    const automation = getAutomationRuntimeSnapshot();
    const botEnabled = START_BOT;
    const automationEnabled = isAutomationEnabled();
    const botReady = botEnabled && bot.ready;
    const automationReady = automationEnabled && automation.healthy;

    // Adapter statuses
    let adapters: Awaited<ReturnType<typeof getExternalAdapterStatus>> = [];
    try { adapters = await getExternalAdapterStatus(); } catch { /* */ }
    const availableCount = adapters.filter(a => a.available).length;

    // Obsidian vault
    const vault = getVaultStats();

    // Obsidian adapter chain
    let obsAdapterStatus: ReturnType<typeof getObsidianAdapterRuntimeStatus> | null = null;
    try { obsAdapterStatus = getObsidianAdapterRuntimeStatus(); } catch { /* */ }

    // n8n delegation
    let n8n: { delegationEnabled: boolean; configuredTasks: number; totalTasks: number } | null = null;
    try {
      const d = getDelegationStatus();
      const tasks = Object.values(d.tasks);
      n8n = {
        delegationEnabled: d.enabled,
        configuredTasks: tasks.filter((t) => t.configured).length,
        totalTasks: tasks.length,
      };
    } catch { /* */ }

    // Migrations
    const migrations = getLastMigrationValidation();

    const overallOk = botReady || automationReady;
    const statusLabel = overallOk ? 'Healthy' : 'Degraded';
    const statusClass = overallOk ? 'bg-green' : 'bg-yellow';

    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Muel Platform Dashboard</title>
  ${CSS}
</head>
<body>
  <div class="header">
    <h1>Muel Platform Dashboard</h1>
    <span class="status-pill ${statusClass}">${statusLabel}</span>
    <button class="refresh-btn" onclick="location.reload()">Refresh</button>
  </div>
  <p class="subtitle">Uptime: ${formatUptime(uptimeSec)} &middot; ${new Date().toISOString()}</p>

  <div class="grid">

    <!-- Runtime -->
    <div class="card">
      <h2>${dot(overallOk)} Runtime</h2>
      <div class="kv"><span class="k">Bot</span><span class="v">${badge(botReady ? 'Online' : botEnabled ? 'Starting' : 'Disabled', botReady)}</span></div>
      <div class="kv"><span class="k">Automation</span><span class="v">${badge(automationReady ? 'Online' : automationEnabled ? 'Starting' : 'Disabled', automationReady)}</span></div>
      <div class="kv"><span class="k">Uptime</span><span class="v">${formatUptime(uptimeSec)}</span></div>
      <div class="kv"><span class="k">Last Ready</span><span class="v" style="font-size:11px">${bot.lastReadyAt ? new Date(bot.lastReadyAt).toLocaleString('ko-KR') : '-'}</span></div>
      <div class="kv"><span class="k">Reconnect Attempts</span><span class="v">${bot.reconnectAttempts}</span></div>
    </div>

    <!-- Adapters -->
    <div class="card">
      <h2>${dot(availableCount > 0)} Adapters (${availableCount}/${adapters.length})</h2>
      ${adapters.map(a => `
        <div class="adapter-row">
          ${dot(a.available)}
          <span class="adapter-name">${esc(String(a.id))}</span>
          <span class="caps">${a.capabilities.length} caps</span>
          ${a.available ? badge('Active', true) : badge('Offline', false)}
        </div>
      `).join('')}
    </div>

    <!-- Obsidian Vault + Adapter Chain -->
    <div class="card card-wide">
      <h2>${dot(vault?.vaultReady ?? false)} Obsidian Vault</h2>
      ${vault ? `
        <div class="kv"><span class="k">Path</span><span class="v" style="font-size:11px">${esc(vault.vaultPath)}</span></div>
        <div class="kv"><span class="k">Vault Ready</span><span class="v">${badge(vault.vaultReady ? 'Yes' : 'No', vault.vaultReady)}</span></div>
        <div class="kv"><span class="k">Sync Mode</span><span class="v">${vault.headlessEnabled
          ? badge('Headless (ob sync)', true)
          : vault.vaultReady
            ? '<span class="badge bg-blue">Desktop App Sync</span>'
            : badge('Not Syncing', false)
        }</span></div>
        <div class="kv"><span class="k">Markdown Files</span><span class="v">${vault.fileCount.toLocaleString()}</span></div>
      ` : `<div style="color:var(--muted);font-size:13px">No vault configured</div>`}

      ${obsAdapterStatus ? `
        <div class="section-label">Adapter Chain (priority order)</div>
        ${obsAdapterStatus.adapters.map(a => {
          const isSelected = Object.values(obsAdapterStatus!.selectedByCapability).includes(a.id);
          return `<div class="obs-adapter-row">
            ${dot(a.available)}
            <span class="obs-adapter-name">${esc(a.id)}</span>
            ${a.available
              ? (isSelected ? badge('Active', true) : '<span class="badge bg-yellow">Standby</span>')
              : badge('Unavailable', false)}
            <span class="obs-caps-list">${a.capabilities.join(', ')}</span>
          </div>`;
        }).join('')}

        <div class="section-label">Capability Routing</div>
        <div class="cap-grid">
          ${Object.entries(obsAdapterStatus.selectedByCapability).map(([cap, handler]) => `
            <div class="cap-item">
              ${dot(handler !== null)}
              <span class="cap-name">${esc(cap.replace('_', ' '))}</span>
              <span class="cap-handler">${handler ? esc(handler) : '<span style="color:var(--red)">none</span>'}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>

    <!-- n8n Delegation -->
    ${n8n ? `
    <div class="card">
      <h2>${dot(n8n.delegationEnabled)} n8n Delegation</h2>
      <div class="kv"><span class="k">Delegation</span><span class="v">${badge(n8n.delegationEnabled ? 'Enabled' : 'Disabled', n8n.delegationEnabled)}</span></div>
      <div class="kv"><span class="k">Configured Tasks</span><span class="v">${n8n.configuredTasks} / ${n8n.totalTasks}</span></div>
    </div>
    ` : ''}

    <!-- Migrations -->
    ${migrations ? `
    <div class="card">
      <h2>${dot(migrations.ok ?? false)} Migrations</h2>
      <div class="kv"><span class="k">Status</span><span class="v">${badge(migrations.ok ? 'Valid' : 'Issues', migrations.ok)}</span></div>
      <div class="kv"><span class="k">Applied</span><span class="v">${migrations.appliedCount}</span></div>
      <div class="kv"><span class="k">Pending</span><span class="v" style="${migrations.pendingCount > 0 ? 'color:var(--yellow)' : ''}">${migrations.pendingCount}</span></div>
      ${migrations.pendingNames.length > 0 ? `<div class="kv"><span class="k">Pending Names</span><span class="v" style="font-size:11px;color:var(--yellow)">${migrations.pendingNames.join(', ')}</span></div>` : ''}
    </div>
    ` : ''}

  </div>

  <p class="ts">Last rendered: ${new Date().toLocaleString('ko-KR')} (server time)</p>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(html);
  });

  return router;
}

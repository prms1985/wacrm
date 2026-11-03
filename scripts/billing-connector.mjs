#!/usr/bin/env node
// Node 22+, no dependencies. Reads only explicitly paired JSON + PDF exports.
import { readdir, readFile, writeFile, rename, mkdir, stat, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function validateExport(data) {
  if (!data || typeof data !== 'object' || typeof data.file !== 'string' || !/^[^/\\:]+\.pdf$/i.test(data.file) || data.file.startsWith('.')) throw new Error('file must be a PDF basename in the export folder');
  for (const key of ['invoice_id', 'to', 'template_name', 'template_language']) if (typeof data[key] !== 'string' || !data[key].trim()) throw new Error('Missing ' + key);
  if (data.consent !== true) throw new Error('Customer consent must be true');
  if (!Array.isArray(data.body_params) || data.body_params.some(v => typeof v !== 'string')) throw new Error('body_params must be a string array');
  return data;
}
export async function runConnector({ folder, baseUrl, key, once = false }) {
  const url = new URL(baseUrl);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) throw new Error('Use HTTPS or a local loopback WACRM URL');
  if (!key) throw new Error('WACRM_API_KEY is required');
  folder = path.resolve(folder);
  const stateDir = path.join(folder, '.wacrm-state');
  await mkdir(stateDir, { recursive: true });
  // Exclusive lock prevents parallel copies of the connector. A crash leaves
  // the lock for staff to inspect, rather than risking concurrent processing.
  const lockPath = path.join(stateDir, 'connector.lock');
  const lock = await open(lockPath, 'wx');
  const stable = new Map();
  async function scan() {
    for (const filename of await readdir(folder)) {
      if (!filename.endsWith('.invoice.json')) continue;
      try {
        const manifestPath = path.join(folder, filename);
        const raw = await readFile(manifestPath, 'utf8');
        const data = validateExport(JSON.parse(raw));
        const pdfPath = path.join(folder, data.file);
        const info = await stat(pdfPath);
        if (info.size > 5 * 1024 * 1024 || info.size < 8) throw new Error('PDF must be 8 bytes to 5 MB');
        const mark = `${info.size}:${info.mtimeMs}:${raw}`;
        if (stable.get(filename) !== mark) { stable.set(filename, mark); continue; }
        const bytes = await readFile(pdfPath);
        const after = await stat(pdfPath);
        if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) { stable.delete(filename); continue; }
        const digest = createHash('sha256').update(raw).update(bytes).digest('hex');
        const stateName = createHash('sha256').update(data.invoice_id).digest('hex') + '.json';
        const statePath = path.join(stateDir, stateName);
        let previous = null;
        try { previous = JSON.parse(await readFile(statePath, 'utf8')); } catch (err) { if (err.code !== 'ENOENT') throw err; }
        if (previous) {
          if (previous.digest !== digest) throw new Error('Invoice reference has changed; review before sending');
          continue; // accepted or uncertain: never automatic resubmission
        }
        const persist = async state => { const tmp = statePath + '.tmp'; await writeFile(tmp, JSON.stringify({ digest, ...state }, null, 2), { mode: 0o600 }); await rename(tmp, statePath); };
        // Persist BEFORE the HTTP call; interruption requires manual review.
        await persist({ state: 'review_required', at: new Date().toISOString() });
        const form = new FormData();
        for (const field of ['invoice_id','to','template_name','template_language','name']) if (data[field]) form.set(field, data[field]);
        form.set('consent', 'true'); form.set('body_params', JSON.stringify(data.body_params));
        form.set('file', new Blob([bytes], { type: 'application/pdf' }), data.file);
        const response = await fetch(url.href.replace(/\/$/, '') + '/api/v1/invoices', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, redirect: 'error', signal: AbortSignal.timeout(90000) });
        const result = await response.json();
        if (!response.ok) { await persist({ state: 'review_required', code: result.error?.code || 'request_failed', httpStatus: response.status }); console.error(`${filename}: not sent or outcome uncertain; review WACRM invoice history.`); continue; }
        await persist({ state: 'accepted', result: result.data });
        console.log(`${filename}: accepted by WhatsApp; delivery status is in WACRM.`);
      } catch (err) { console.error(`${filename}: ${err.message}`); }
    }
  }
  try {
    // Two scans also make --once useful without sending a partial PDF export.
    await scan(); await new Promise(resolve => setTimeout(resolve, 2000)); await scan();
    if (!once) while (true) { await new Promise(resolve => setTimeout(resolve, 5000)); await scan(); }
  } finally { await lock.close(); await unlink(lockPath); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.env.WACRM_EXPORT_FOLDER || !process.env.WACRM_URL) { console.error('Set WACRM_EXPORT_FOLDER, WACRM_URL and WACRM_API_KEY. See docs/billing-invoices.md.'); process.exitCode = 1; }
  else runConnector({ folder: process.env.WACRM_EXPORT_FOLDER, baseUrl: process.env.WACRM_URL, key: process.env.WACRM_API_KEY, once: process.argv.includes('--once') }).catch(err => { console.error(err.message); process.exitCode = 1; });
}

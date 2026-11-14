'use strict';

// User settings carried in the install URL, Stremio-style: https://host/<config>/manifest.json.
// <config> is base64url JSON { langs: [...], rows: [...] }. No accounts, nothing stored on the server.

const LANG_OPTIONS = { en: 'English', yo: 'Yoruba', ig: 'Igbo', ha: 'Hausa', other: 'Pidgin & other languages' };
const ROW_OPTIONS = { new: 'New on Select Naija', series: 'Nigerian series', classics: 'Nigerian classics' };
const DEFAULT = Object.freeze({ langs: Object.keys(LANG_OPTIONS), rows: Object.keys(ROW_OPTIONS) });

function encodeConfig(cfg) {
  return Buffer.from(JSON.stringify({ langs: cfg.langs, rows: cfg.rows })).toString('base64url');
}

/** Returns a settings object, or null when the segment is not a Select Naija config. */
function decodeConfig(segment) {
  if (!segment || !/^[A-Za-z0-9_-]{8,400}$/.test(segment)) return null;
  try {
    const raw = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    const langs = (Array.isArray(raw.langs) ? raw.langs : []).filter((l) => LANG_OPTIONS[l]);
    const rows = (Array.isArray(raw.rows) ? raw.rows : []).filter((r) => ROW_OPTIONS[r]);
    return { langs: langs.length ? langs : DEFAULT.langs, rows };
  } catch {
    return null;
  }
}

/** True when a title is in one of the chosen languages. */
function wantsTitle(title, cfg) {
  if (!cfg || cfg === DEFAULT) return true;
  const langs = title.languages || [];
  return langs.some((l) => cfg.langs.includes(['en', 'yo', 'ig', 'ha'].includes(l) ? l : 'other')) || (!langs.length && cfg.langs.includes('en'));
}

function configurePage(origin, current = DEFAULT) {
  const box = (group, key, label, on) => `<label><input type="checkbox" name="${group}" value="${key}"${on ? ' checked' : ''}> ${label}</label>`;
  return `<!DOCTYPE html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Select Naija settings</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;background:#0f1a12;color:#eef3ee;margin:0;padding:24px;max-width:640px}
h1{font-size:26px;margin:0 0 4px}p{color:#b8c7ba}fieldset{border:1px solid #2f4a35;border-radius:10px;margin:18px 0;padding:12px 16px}
legend{padding:0 6px;font-weight:600}label{display:block;padding:6px 0}input[type=checkbox]{transform:scale(1.3);margin-right:8px}
.url{word-break:break-all;background:#1a2a1e;border-radius:8px;padding:10px;font-family:monospace;font-size:14px}
a.btn,button{display:inline-block;background:#2e7d32;color:#fff;border:0;border-radius:8px;padding:12px 18px;font-size:16px;text-decoration:none;margin:8px 8px 0 0;cursor:pointer}
button.secondary{background:#37474f}
</style></head><body>
<h1>Select Naija</h1><p>Nigerian films and series that play inside Nuvio's own player. Choose what to show, then install.</p>
<form id="f">
<fieldset><legend>Languages</legend>${Object.entries(LANG_OPTIONS).map(([k, v]) => box('langs', k, v, current.langs.includes(k))).join('')}</fieldset>
<fieldset><legend>Extra rows</legend>${Object.entries(ROW_OPTIONS).map(([k, v]) => box('rows', k, v, current.rows.includes(k))).join('')}</fieldset>
</form>
<p>Install link for Nuvio (paste it under Addons → Add addon):</p>
<div class="url" id="url"></div>
<a class="btn" id="install" href="#">Install</a><button id="copy" class="secondary" type="button">Copy link</button>
<script>
const origin=${JSON.stringify(origin)};
function enc(o){return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'')}
function update(){const f=new FormData(document.getElementById('f'));const cfg={langs:f.getAll('langs'),rows:f.getAll('rows')};
const u=origin+'/'+enc(cfg)+'/manifest.json';document.getElementById('url').textContent=u;document.getElementById('install').href=u.replace(/^https?:/,'stremio:');}
document.getElementById('f').addEventListener('change',update);
document.getElementById('copy').addEventListener('click',()=>{navigator.clipboard&&navigator.clipboard.writeText(document.getElementById('url').textContent);document.getElementById('copy').textContent='Copied';});
update();
</script></body></html>`;
}

module.exports = { LANG_OPTIONS, ROW_OPTIONS, DEFAULT, encodeConfig, decodeConfig, wantsTitle, configurePage };

'use strict';

const PORTIONS = ['fat', 'carbs', 'veggies', 'protein'];
const LB_PER_KG = 2.20462;
const DEFAULT_SETTINGS = { units: 'kg', fat: 0, carbs: 0, veggies: 0, protein: 0 };

// --- IndexedDB -------------------------------------------------------------
// "days" holds one row per date: { date, fat, carbs, veggies, protein, weightKg }.
// "settings" holds a single row under the key "settings".

const dbPromise = new Promise((resolve, reject) => {
  const req = indexedDB.open('hand-portions', 1);
  req.onupgradeneeded = () => {
    const db = req.result;
    db.createObjectStore('days', { keyPath: 'date' });
    db.createObjectStore('settings');
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function tx(store, mode, fn) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

const getSettings = async () =>
  ({ ...DEFAULT_SETTINGS, ...(await tx('settings', 'readonly', s => s.get('settings'))) });
const saveSettings = settings => tx('settings', 'readwrite', s => s.put(settings, 'settings'));
const getDays = () => tx('days', 'readonly', s => s.getAll());
const putDays = days => tx('days', 'readwrite', s => days.forEach(day => s.put(day)));

// Read-modify-write inside one transaction so rapid adds can't clobber each other.
async function addToDay(date, portions, weightKg) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const t = db.transaction('days', 'readwrite');
    const store = t.objectStore('days');
    const get = store.get(date);
    get.onsuccess = () => {
      const day = get.result || { date, fat: 0, carbs: 0, veggies: 0, protein: 0, weightKg: null };
      for (const k of PORTIONS) day[k] = round(day[k] + portions[k]);
      if (weightKg != null) day.weightKg = weightKg;
      store.put(day);
    };
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}

// --- Helpers ---------------------------------------------------------------

const round = n => Math.round(n * 100) / 100;
const num = v => (v === '' || v == null ? null : Number(v));

function todayLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function formatDate(iso) {
  const d = new Date(iso + 'T00:00');
  const opts = { weekday: 'short', month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = '2-digit';
  return d.toLocaleDateString(undefined, opts);
}

const toDisplayWeight = (kg, units) => round(units === 'lb' ? kg * LB_PER_KG : kg);
const fromDisplayWeight = (w, units) => (units === 'lb' ? w / LB_PER_KG : w);

// --- UI --------------------------------------------------------------------

const settingsForm = document.getElementById('settings');
const settingsToggle = document.getElementById('settings-toggle');
const entryForm = document.getElementById('entry');
const daysBody = document.getElementById('days');
const emptyMsg = document.getElementById('empty');

let settings = { ...DEFAULT_SETTINGS };

function fillSettingsForm() {
  settingsForm.units.value = settings.units;
  for (const k of PORTIONS) settingsForm[k].value = settings[k] || '';
  document.querySelectorAll('.unit').forEach(el => (el.textContent = settings.units));
}

function cell(value, target) {
  const td = document.createElement('td');
  td.textContent = value;
  if (target > 0) {
    const t = document.createElement('span');
    t.className = 'target';
    t.textContent = ` / ${target}`;
    td.append(t);
    if (value > target) td.className = 'over';
    else if (value === target) td.className = 'hit';
  }
  return td;
}

async function render() {
  const days = (await getDays()).sort((a, b) => b.date.localeCompare(a.date));
  daysBody.replaceChildren(...days.map(day => {
    const tr = document.createElement('tr');
    const date = document.createElement('td');
    date.textContent = formatDate(day.date);
    date.title = day.date;
    const weight = document.createElement('td');
    weight.textContent = day.weightKg == null ? '–' : toDisplayWeight(day.weightKg, settings.units);
    tr.append(date, weight, ...PORTIONS.map(k => cell(day[k], settings[k])));
    return tr;
  }));
  emptyMsg.hidden = days.length > 0;
}

// --- CSV -------------------------------------------------------------------
// Columns: date, weight_kg or weight_lb (current units), fat, carbs, veggies, protein.

async function exportCsv() {
  const days = (await getDays()).sort((a, b) => a.date.localeCompare(b.date));
  const lines = [['date', `weight_${settings.units}`, ...PORTIONS].join(',')];
  for (const day of days) {
    const weight = day.weightKg == null ? '' : toDisplayWeight(day.weightKg, settings.units);
    lines.push([day.date, weight, ...PORTIONS.map(k => day[k])].join(','));
  }
  const url = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `hand-portions-${todayLocal()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function parseCsv(text) {
  const [header, ...rows] = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/).map(line => line.split(',').map(c => c.trim()));
  const col = name => header.indexOf(name);
  const weightCol = col('weight_kg') >= 0 ? col('weight_kg') : col('weight_lb');
  const weightUnits = col('weight_kg') >= 0 ? 'kg' : 'lb';
  if (col('date') < 0) throw new Error('Missing "date" column');

  return rows.filter(r => r.some(Boolean)).map((r, i) => {
    const date = r[col('date')];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Row ${i + 2}: bad date "${date}"`);
    const day = { date, weightKg: null };
    const weight = weightCol >= 0 ? num(r[weightCol]) : null;
    if (weight != null) day.weightKg = fromDisplayWeight(weight, weightUnits);
    for (const k of PORTIONS) {
      day[k] = col(k) >= 0 ? num(r[col(k)]) || 0 : 0;
      if (Number.isNaN(day[k])) throw new Error(`Row ${i + 2}: bad ${k}`);
    }
    if (Number.isNaN(day.weightKg)) throw new Error(`Row ${i + 2}: bad weight`);
    return day;
  });
}

document.getElementById('export').addEventListener('click', exportCsv);

document.getElementById('import').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const days = parseCsv(await file.text());
    if (!confirm(`Import ${days.length} day(s)? Existing days with the same date are replaced.`)) return;
    await putDays(days);
    render();
  } catch (err) {
    alert(`Import failed: ${err.message}`);
  }
});

settingsToggle.addEventListener('click', () => {
  settingsForm.hidden = !settingsForm.hidden;
  settingsToggle.setAttribute('aria-expanded', String(!settingsForm.hidden));
});

settingsForm.addEventListener('submit', async e => {
  e.preventDefault();
  settings = { units: settingsForm.units.value };
  for (const k of PORTIONS) settings[k] = num(settingsForm[k].value) || 0;
  await saveSettings(settings);
  fillSettingsForm();
  settingsForm.hidden = true;
  settingsToggle.setAttribute('aria-expanded', 'false');
  render();
});

entryForm.addEventListener('submit', async e => {
  e.preventDefault();
  const portions = {};
  for (const k of PORTIONS) portions[k] = num(entryForm[k].value) || 0;
  const weight = num(entryForm.weight.value);
  const weightKg = weight == null ? null : fromDisplayWeight(weight, settings.units);
  await addToDay(entryForm.date.value, portions, weightKg);
  for (const k of [...PORTIONS, 'weight']) entryForm[k].value = '';
  render();
});

(async () => {
  entryForm.date.value = todayLocal();
  settings = await getSettings();
  fillSettingsForm();
  render();
})();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

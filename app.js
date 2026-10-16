'use strict';

/* =========================================================================
 * Arbre familial — application web mobile, sans dépendance ni serveur.
 *
 * Modèle de données (une personne) :
 *   { id, firstName, lastName, sex: 'M'|'F'|'U',
 *     birthDate, birthPlace, deathDate,   // dates : 'AAAA', 'AAAA-MM' ou 'AAAA-MM-JJ'
 *     fatherId, motherId, spouseIds: [], notes }
 *
 * Les frères/sœurs et les enfants ne sont pas stockés : ils sont déduits
 * des liens père/mère. Les conjoints sont toujours enregistrés des deux côtés.
 * ========================================================================= */

const STORAGE_KEY = 'arbre-familial:v1';
const FORMAT_VERSION = 1;

/* ----------------------------- Stockage -------------------------------- */

let people = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    return Array.isArray(data?.people) ? data.people.map(normalize) : [];
  } catch {
    return [];
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: FORMAT_VERSION, people }));
  } catch {
    toast('Impossible d’enregistrer (stockage indisponible).');
  }
}

function normalize(p) {
  return {
    id: String(p.id || newId()),
    firstName: String(p.firstName || '').trim(),
    lastName: String(p.lastName || '').trim(),
    sex: ['M', 'F'].includes(p.sex) ? p.sex : 'U',
    birthDate: p.birthDate || '',
    birthPlace: String(p.birthPlace || '').trim(),
    deathDate: p.deathDate || '',
    fatherId: p.fatherId || '',
    motherId: p.motherId || '',
    spouseIds: Array.isArray(p.spouseIds) ? [...new Set(p.spouseIds.map(String))] : [],
    notes: String(p.notes || ''),
  };
}

function newId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const byId = (id) => people.find((p) => p.id === id);

/* ------------------------------ Parenté -------------------------------- */

const childrenOf = (id) => people.filter((p) => p.fatherId === id || p.motherId === id);
const parentsOf = (p) => [byId(p.fatherId), byId(p.motherId)].filter(Boolean);
const spousesOf = (p) => p.spouseIds.map(byId).filter(Boolean);

function siblingsOf(p) {
  return people.filter(
    (o) =>
      o.id !== p.id &&
      ((p.fatherId && o.fatherId === p.fatherId) || (p.motherId && o.motherId === p.motherId))
  );
}

/** Vrai si `ancestorId` est un ancêtre de la personne `id`. */
function isAncestor(ancestorId, id, seen = new Set()) {
  const p = byId(id);
  if (!p || seen.has(id)) return false;
  seen.add(id);
  return [p.fatherId, p.motherId].some(
    (pid) => pid && (pid === ancestorId || isAncestor(ancestorId, pid, seen))
  );
}

/* ------------------------------- Dates --------------------------------- */

/** Accepte JJ/MM/AAAA, MM/AAAA, AAAA (ou séparateurs - .) et AAAA-MM-JJ. */
function parseDate(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  let m;
  let y, mo, d;
  if ((m = s.match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/))) [, y, mo, d] = m;
  else if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [, d, mo, y] = m;
  else if ((m = s.match(/^(\d{1,2})[/.-](\d{4})$/))) [, mo, y] = m;
  else return null;

  if (mo && (mo < 1 || mo > 12)) return null;
  if (d) {
    const dt = new Date(Date.UTC(+y, mo - 1, +d));
    if (dt.getUTCMonth() !== mo - 1) return null; // ex. 31/02
  }
  return [y, mo && mo.padStart(2, '0'), d && d.padStart(2, '0')].filter(Boolean).join('-');
}

function formatDate(iso) {
  if (!iso) return '';
  return iso.split('-').reverse().join('/');
}

const year = (iso) => (iso ? iso.slice(0, 4) : '');

function lifespan(p) {
  const b = year(p.birthDate);
  const d = year(p.deathDate);
  if (!b && !d) return '';
  return d ? `${b || '?'} – ${d}` : `né${p.sex === 'F' ? 'e' : ''} en ${b}`;
}

/* ------------------------------ Utilitaires ----------------------------- */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

const fullName = (p) => `${p.firstName} ${p.lastName}`.trim();
const initials = (p) => ((p.firstName[0] || '') + (p.lastName[0] || '')).toUpperCase();

function sortPeople(list) {
  return [...list].sort(
    (a, b) =>
      a.lastName.localeCompare(b.lastName, 'fr') ||
      a.firstName.localeCompare(b.firstName, 'fr') ||
      (a.birthDate || '').localeCompare(b.birthDate || '')
  );
}

/** Recherche insensible à la casse et aux accents. */
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2800);
}

/* ------------------------------ Navigation ------------------------------ */
// L'URL (#/liste, #/arbre, #/personne/<id>) permet au bouton « retour » du téléphone de fonctionner.

let treeMode = 'desc';
let treeRootId = '';

function route() {
  const [, view, id] = location.hash.split('/');
  if (view === 'personne' && byId(id)) showView('person', id);
  else if (view === 'arbre') showView('tree');
  else showView('list');
}

function showView(name, id) {
  $$('.view').forEach((v) => v.classList.remove('active'));
  $(`#view-${name}`).classList.add('active');
  $$('.tab').forEach((t) =>
    t.classList.toggle('active', t.dataset.view === (name === 'tree' ? 'tree' : 'list'))
  );
  if (name === 'list') renderList();
  if (name === 'person') renderPerson(id);
  if (name === 'tree') renderTree();
  window.scrollTo(0, 0);
}

const go = (hash) => (location.hash = hash);

/* ------------------------------- Rendu ---------------------------------- */

function renderList() {
  const q = fold($('#search').value.trim());
  const list = sortPeople(people).filter(
    (p) => !q || fold(`${p.firstName} ${p.lastName} ${p.birthPlace}`).includes(q)
  );
  $('#personList').innerHTML = list
    .map(
      (p) => `
      <li class="person-item" data-id="${esc(p.id)}">
        <span class="avatar ${p.sex}">${esc(initials(p))}</span>
        <span>
          <span class="name">${esc(fullName(p))}</span><br>
          <span class="meta">${esc([lifespan(p), p.birthPlace].filter(Boolean).join(' · '))}</span>
        </span>
      </li>`
    )
    .join('');
  $('#emptyMsg').hidden = people.length > 0;
  $('#count').textContent = people.length
    ? `${list.length} personne${list.length > 1 ? 's' : ''}${q ? ' trouvée' + (list.length > 1 ? 's' : '') : ''}`
    : '';
}

function chips(list) {
  if (!list.length) return '<span class="muted">—</span>';
  return `<div class="chips">${sortPeople(list)
    .map((p) => `<button class="chip" data-goto="${esc(p.id)}">${esc(fullName(p))}</button>`)
    .join('')}</div>`;
}

function renderPerson(id) {
  const p = byId(id);
  const facts = [
    ['Naissance', [formatDate(p.birthDate), p.birthPlace].filter(Boolean).join(' à ')],
    ['Décès', formatDate(p.deathDate)],
    ['Sexe', { M: 'Homme', F: 'Femme' }[p.sex] || ''],
  ].filter(([, v]) => v);

  $('#view-person').innerHTML = `
    <button class="back" data-back>← Retour</button>
    <div class="card">
      <h2>${esc(fullName(p))}</h2>
      ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
      ${p.notes ? `<p>${esc(p.notes).replace(/\n/g, '<br>')}</p>` : ''}
    </div>
    <div class="card"><h3>Parents</h3>${chips(parentsOf(p))}</div>
    <div class="card"><h3>Conjoint(s)</h3>${chips(spousesOf(p))}</div>
    <div class="card"><h3>Enfants</h3>${chips(childrenOf(p.id))}</div>
    <div class="card"><h3>Frères et sœurs</h3>${chips(siblingsOf(p))}</div>
    <div class="actions">
      <button class="btn primary" data-edit="${esc(p.id)}">Modifier</button>
      <button class="btn" data-add-child="${esc(p.id)}">+ Ajouter un enfant</button>
      <button class="btn" data-show-tree="${esc(p.id)}">Voir dans l’arbre</button>
      <button class="btn danger" data-delete="${esc(p.id)}">Supprimer</button>
    </div>`;
}

/* -------------------------------- Arbre --------------------------------- */

function nodeHtml(p) {
  return `<span class="node ${p.sex}${p.id === treeRootId ? ' focus' : ''}" data-goto="${esc(p.id)}">
    ${esc(p.firstName)} <strong>${esc(p.lastName)}</strong><small>${esc(lifespan(p))}</small></span>`;
}

function descendantsHtml(p, seen) {
  if (seen.has(p.id)) return '';
  seen.add(p.id);
  const spouses = spousesOf(p);
  const couple = [nodeHtml(p), ...spouses.map(nodeHtml)].join('<span class="amp">&amp;</span>');
  const kids = sortByBirth(childrenOf(p.id));
  const sub = kids.map((k) => descendantsHtml(k, seen)).filter(Boolean);
  return `<li><span class="couple">${couple}</span>${sub.length ? `<ul>${sub.join('')}</ul>` : ''}</li>`;
}

// Ancêtres : la personne en haut, ses parents en dessous, puis les grands-parents, etc.
function ancestorsHtml(p, seen) {
  if (seen.has(p.id)) return '';
  seen.add(p.id);
  const sub = parentsOf(p).map((a) => ancestorsHtml(a, seen)).filter(Boolean);
  return `<li>${nodeHtml(p)}${sub.length ? `<ul>${sub.join('')}</ul>` : ''}</li>`;
}

const sortByBirth = (list) =>
  [...list].sort((a, b) => (a.birthDate || '9999').localeCompare(b.birthDate || '9999'));

function renderTree() {
  const sel = $('#treeRoot');
  if (!byId(treeRootId)) {
    // Par défaut : la personne la plus ancienne sans parents connus.
    const roots = sortByBirth(people.filter((p) => !parentsOf(p).length));
    treeRootId = (roots[0] || people[0] || {}).id || '';
  }
  sel.innerHTML = sortPeople(people)
    .map((p) => `<option value="${esc(p.id)}"${p.id === treeRootId ? ' selected' : ''}>${esc(fullName(p))}</option>`)
    .join('');
  $$('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === treeMode));

  const root = byId(treeRootId);
  if (!root) {
    $('#tree').innerHTML = '<p class="empty">Ajoutez des personnes pour voir l’arbre.</p>';
    return;
  }
  const html = treeMode === 'desc' ? descendantsHtml(root, new Set()) : ancestorsHtml(root, new Set());
  $('#tree').innerHTML = `<div class="tree"><ul>${html}</ul></div>`;
  // Centre horizontalement l'arbre s'il dépasse la largeur de l'écran.
  const wrap = $('#tree');
  wrap.scrollLeft = (wrap.scrollWidth - wrap.clientWidth) / 2;
}

/* ----------------------------- Formulaire ------------------------------- */

const dialog = $('#personDialog');
const form = $('#personForm');

function fillSelect(select, candidates, selected, emptyLabel) {
  const sel = new Set([].concat(selected || []));
  select.innerHTML =
    (emptyLabel ? `<option value="">${emptyLabel}</option>` : '') +
    sortPeople(candidates)
      .map((p) => {
        const y = year(p.birthDate);
        return `<option value="${esc(p.id)}"${sel.has(p.id) ? ' selected' : ''}>${esc(fullName(p))}${y ? ` (${y})` : ''}</option>`;
      })
      .join('');
}

function openForm(person = null, preset = {}) {
  const p = person || normalize({ id: '', ...preset });
  form.reset();
  $('#formError').hidden = true;
  $('#formTitle').textContent = person ? 'Modifier' : 'Nouvelle personne';
  form.personId.value = person ? p.id : '';
  form.firstName.value = p.firstName;
  form.lastName.value = p.lastName;
  form.sex.value = p.sex;
  form.birthDate.value = formatDate(p.birthDate);
  form.birthPlace.value = p.birthPlace;
  form.deathDate.value = formatDate(p.deathDate);
  form.notes.value = p.notes;

  // On n'autorise pas de lien qui créerait une boucle (ex. être son propre grand-père).
  const others = people.filter((o) => o.id !== p.id);
  const notDescendant = others.filter((o) => !person || !isAncestor(p.id, o.id));
  fillSelect(form.fatherId, notDescendant.filter((o) => o.sex !== 'F'), p.fatherId, '— inconnu —');
  fillSelect(form.motherId, notDescendant.filter((o) => o.sex !== 'M'), p.motherId, '— inconnue —');
  fillSelect(form.spouseIds, others, p.spouseIds);
  dialog.showModal();
}

function formError(msg) {
  const e = $('#formError');
  e.textContent = msg;
  e.hidden = false;
}

form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const birthDate = parseDate(form.birthDate.value);
  const deathDate = parseDate(form.deathDate.value);
  if (birthDate === null) return formError('Date de naissance invalide (ex. 24/05/1952, 05/1952 ou 1952).');
  if (deathDate === null) return formError('Date de décès invalide (ex. 24/05/1952, 05/1952 ou 1952).');
  if (birthDate && deathDate && deathDate < birthDate) return formError('Le décès est antérieur à la naissance.');

  const id = form.personId.value || newId();
  const fatherId = form.fatherId.value;
  const motherId = form.motherId.value;
  if (fatherId && fatherId === motherId) return formError('Le père et la mère doivent être différents.');
  const spouseIds = [...form.spouseIds.selectedOptions].map((o) => o.value);

  const data = normalize({
    id,
    firstName: form.firstName.value,
    lastName: form.lastName.value,
    sex: form.sex.value,
    birthDate,
    birthPlace: form.birthPlace.value,
    deathDate,
    fatherId,
    motherId,
    spouseIds,
    notes: form.notes.value,
  });
  if (!data.firstName || !data.lastName) return formError('Le prénom et le nom sont obligatoires.');

  const existing = byId(id);
  const oldSpouses = existing ? existing.spouseIds : [];
  if (existing) Object.assign(existing, data);
  else people.push(data);

  // Conjoints : on garde le lien des deux côtés.
  for (const sid of oldSpouses) if (!spouseIds.includes(sid)) {
    const s = byId(sid);
    if (s) s.spouseIds = s.spouseIds.filter((x) => x !== id);
  }
  for (const sid of spouseIds) {
    const s = byId(sid);
    if (s && !s.spouseIds.includes(id)) s.spouseIds.push(id);
  }

  save();
  dialog.close();
  toast(existing ? 'Modifications enregistrées' : 'Personne ajoutée');
  if (location.hash === `#/personne/${id}`) route();
  else go(`#/personne/${id}`);
});

$('#cancelBtn').addEventListener('click', () => dialog.close());

function deletePerson(id) {
  const p = byId(id);
  if (!p || !confirm(`Supprimer ${fullName(p)} ? Les liens avec cette personne seront retirés.`)) return;
  people = people.filter((o) => o.id !== id);
  for (const o of people) {
    if (o.fatherId === id) o.fatherId = '';
    if (o.motherId === id) o.motherId = '';
    o.spouseIds = o.spouseIds.filter((x) => x !== id);
  }
  save();
  toast('Personne supprimée');
  go('#/liste');
}

/* -------------------------- Export / import ----------------------------- */

function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const file = new File([blob], filename, { type });
  // Sur téléphone : ouvre le menu de partage (WhatsApp, e-mail…) si possible.
  if (navigator.canShare?.({ files: [file] })) {
    return navigator.share({ files: [file], title: 'Arbre familial' }).catch(() => {});
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

function exportJson() {
  const json = JSON.stringify({ app: 'arbre-familial', version: FORMAT_VERSION, exported: new Date().toISOString(), people }, null, 2);
  download(`arbre-familial-${stamp()}.json`, json, 'application/json');
}

/** Export GEDCOM 5.5.1, le format d'échange standard entre logiciels de généalogie. */
function toGedcom() {
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const gedDate = (iso) => {
    const [y, m, d] = iso.split('-');
    return [d && String(+d), m && MONTHS[m - 1], y].filter(Boolean).join(' ');
  };
  const clean = (s) => String(s).replace(/[\r\n]+/g, ' ');
  const indi = new Map(people.map((p, i) => [p.id, `@I${i + 1}@`]));

  // Une « famille » GEDCOM = un couple (ou un parent seul) et ses enfants.
  const fams = new Map();
  const famKey = (a, b) => [a || '', b || ''].join('|');
  const getFam = (husb, wife) => {
    const k = famKey(husb, wife);
    if (!fams.has(k)) fams.set(k, { id: `@F${fams.size + 1}@`, husb, wife, children: [] });
    return fams.get(k);
  };
  for (const p of people) {
    if (p.fatherId || p.motherId) getFam(byId(p.fatherId) && p.fatherId, byId(p.motherId) && p.motherId).children.push(p.id);
  }
  for (const p of people) {
    for (const sid of p.spouseIds) {
      const s = byId(sid);
      if (!s || p.id > sid) continue; // chaque couple une seule fois
      const [h, w] = p.sex === 'F' || s.sex === 'M' ? [sid, p.id] : [p.id, sid];
      if (!fams.has(famKey(h, w)) && !fams.has(famKey(w, h))) getFam(h, w);
    }
  }

  const out = ['0 HEAD', '1 SOUR ARBRE_FAMILIAL', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8'];
  for (const p of people) {
    out.push(`0 ${indi.get(p.id)} INDI`, `1 NAME ${clean(p.firstName)} /${clean(p.lastName)}/`);
    out.push(`2 GIVN ${clean(p.firstName)}`, `2 SURN ${clean(p.lastName)}`);
    if (p.sex !== 'U') out.push(`1 SEX ${p.sex}`);
    if (p.birthDate || p.birthPlace) {
      out.push('1 BIRT');
      if (p.birthDate) out.push(`2 DATE ${gedDate(p.birthDate)}`);
      if (p.birthPlace) out.push(`2 PLAC ${clean(p.birthPlace)}`);
    }
    if (p.deathDate) out.push('1 DEAT', `2 DATE ${gedDate(p.deathDate)}`);
    for (const f of fams.values()) {
      if (f.children.includes(p.id)) out.push(`1 FAMC ${f.id}`);
      if (f.husb === p.id || f.wife === p.id) out.push(`1 FAMS ${f.id}`);
    }
    if (p.notes) {
      const [first, ...rest] = p.notes.split(/\r?\n/);
      out.push(`1 NOTE ${first}`, ...rest.map((l) => `2 CONT ${l}`));
    }
  }
  for (const f of fams.values()) {
    out.push(`0 ${f.id} FAM`);
    if (f.husb) out.push(`1 HUSB ${indi.get(f.husb)}`);
    if (f.wife) out.push(`1 WIFE ${indi.get(f.wife)}`);
    for (const c of f.children) out.push(`1 CHIL ${indi.get(c)}`);
  }
  out.push('0 TRLR');
  return out.join('\r\n') + '\r\n';
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const incoming = (Array.isArray(data) ? data : data.people || []).map(normalize);
      if (!incoming.length) throw new Error('vide');
      // Fusion : les fiches de même identifiant sont mises à jour, les autres ajoutées.
      let added = 0;
      let updated = 0;
      for (const p of incoming) {
        const existing = byId(p.id);
        if (existing) { Object.assign(existing, p); updated++; }
        else { people.push(p); added++; }
      }
      save();
      $('#menuDialog').close();
      toast(`Import : ${added} ajoutée(s), ${updated} mise(s) à jour`);
      route();
    } catch {
      toast('Fichier non reconnu.');
    }
  };
  reader.readAsText(file);
}

function loadDemo() {
  if (people.length && !confirm('Ajouter la famille d’exemple aux données existantes ?')) return;
  const d = (id, firstName, lastName, sex, birthDate, extra = {}) =>
    normalize({ id, firstName, lastName, sex, birthDate, ...extra });
  people.push(
    d('demo1', 'Jean', 'Martin', 'M', '1930-04-12', { birthPlace: 'Lyon', deathDate: '2010-01-03', spouseIds: ['demo2'] }),
    d('demo2', 'Marie', 'Dupont', 'F', '1933-09-30', { birthPlace: 'Mâcon', spouseIds: ['demo1'] }),
    d('demo3', 'Pierre', 'Martin', 'M', '1958-06-21', { fatherId: 'demo1', motherId: 'demo2', spouseIds: ['demo4'] }),
    d('demo4', 'Sophie', 'Bernard', 'F', '1960', { spouseIds: ['demo3'] }),
    d('demo5', 'Claire', 'Martin', 'F', '1962-02', { fatherId: 'demo1', motherId: 'demo2' }),
    d('demo6', 'Lucas', 'Martin', 'M', '1988-11-05', { fatherId: 'demo3', motherId: 'demo4' }),
    d('demo7', 'Emma', 'Martin', 'F', '1991-03-17', { fatherId: 'demo3', motherId: 'demo4' })
  );
  people = people.filter((p, i, a) => a.findIndex((o) => o.id === p.id) === i);
  save();
  $('#menuDialog').close();
  toast('Exemple chargé');
  route();
}

/* ------------------------------ Événements ------------------------------ */

$('#addBtn').addEventListener('click', () => openForm());
$('#search').addEventListener('input', renderList);
$$('.tab').forEach((t) =>
  t.addEventListener('click', () => go(t.dataset.view === 'tree' ? '#/arbre' : '#/liste'))
);
$('#treeRoot').addEventListener('change', (e) => { treeRootId = e.target.value; renderTree(); });
$$('.seg-btn').forEach((b) => b.addEventListener('click', () => { treeMode = b.dataset.mode; renderTree(); }));

// Délégation : un seul écouteur pour tous les boutons générés dynamiquement.
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-id],[data-goto],[data-edit],[data-add-child],[data-show-tree],[data-delete],[data-back]');
  if (!el) return;
  const ds = el.dataset;
  if (ds.id || ds.goto) go(`#/personne/${ds.id || ds.goto}`);
  else if (ds.edit) openForm(byId(ds.edit));
  else if (ds.addChild) {
    const parent = byId(ds.addChild);
    const spouse = spousesOf(parent)[0];
    const other = spouse && spousesOf(parent).length === 1 ? spouse.id : '';
    openForm(null, {
      lastName: parent.sex === 'F' && spouse ? spouse.lastName : parent.lastName,
      fatherId: parent.sex === 'F' ? other : parent.id,
      motherId: parent.sex === 'F' ? parent.id : other,
    });
  } else if (ds.showTree) { treeRootId = ds.showTree; go('#/arbre'); }
  else if (ds.delete) deletePerson(ds.delete);
  else if ('back' in ds) history.length > 1 ? history.back() : go('#/liste');
});

$('#menuBtn').addEventListener('click', () => $('#menuDialog').showModal());
$('#closeMenuBtn').addEventListener('click', () => $('#menuDialog').close());
$('#exportJsonBtn').addEventListener('click', () => (people.length ? exportJson() : toast('Rien à exporter.')));
$('#exportGedBtn').addEventListener('click', () =>
  people.length ? download(`arbre-familial-${stamp()}.ged`, toGedcom(), 'text/plain') : toast('Rien à exporter.')
);
$('#importInput').addEventListener('change', (e) => {
  if (e.target.files[0]) importJson(e.target.files[0]);
  e.target.value = '';
});
$('#demoBtn').addEventListener('click', loadDemo);
$('#clearBtn').addEventListener('click', () => {
  if (!people.length || !confirm('Effacer toutes les personnes de ce téléphone ? Pensez à exporter avant.')) return;
  people = [];
  save();
  $('#menuDialog').close();
  go('#/liste');
  route();
});

window.addEventListener('hashchange', route);
route();

// Mode hors ligne / installation sur l'écran d'accueil (nécessite HTTPS ou localhost).
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

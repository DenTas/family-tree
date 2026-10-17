// Tests des règles de sécurité Firestore, sur l'émulateur Firebase local.
// Lancer avec : npm test   (nécessite Java 21 ; voir README)
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, writeBatch, serverTimestamp, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'fs';

const env = await initializeTestEnvironment({
  projectId: 'demo-famille',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
});
await env.clearFirestore();
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'members/admin@x.fr'), { role: 'admin' });
  await setDoc(doc(db, 'members/editor@x.fr'), { role: 'editor' });
  await setDoc(doc(db, 'members/viewer@x.fr'), { role: 'viewer' });
  await setDoc(doc(db, 'people/p1'), { firstName: 'A', lastName: 'B' });
});
const as = (uid, email, verified = true) => env.authenticatedContext(uid, { email, email_verified: verified }).firestore();
const admin = as('ua', 'Admin@x.fr'), editor = as('ue', 'editor@x.fr'), viewer = as('uv', 'viewer@x.fr');
const stranger = as('us', 'stranger@x.fr'), unverified = as('uu', 'editor@x.fr', false);
const anon = env.unauthenticatedContext().firestore();

const person = (uid) => ({ firstName: 'Jean', lastName: 'Martin', sex: 'M', birthDate: '1930', birthPlace: '', deathDate: '',
  fatherId: '', motherId: '', spouseIds: [], notes: '', updatedBy: uid, updatedAt: serverTimestamp() });
const hist = (uid, email, n = 1) => ({ label: 'x', changes: Array.from({ length: n }, (_, i) => ({ id: 'p' + i })), byUid: uid, byEmail: email, byName: '', at: serverTimestamp() });

let ok = 0, ko = 0;
async function t(name, p) { try { await p; ok++; console.log('✔', name); } catch (e) { ko++; console.log('✘', name, e.message); } }

await t('anonyme ne lit pas', assertFails(getDoc(doc(anon, 'people/p1'))));
await t('non-membre ne lit pas', assertFails(getDocs(collection(stranger, 'people'))));
await t('non-membre lit sa fiche membre (absente)', assertSucceeds(getDoc(doc(stranger, 'members/stranger@x.fr'))));
await t('e-mail non vérifié refusé', assertFails(getDocs(collection(unverified, 'people'))));
await t('lecteur lit', assertSucceeds(getDocs(collection(viewer, 'people'))));
await t('lecteur lit l’historique', assertSucceeds(getDocs(collection(viewer, 'history'))));
await t('lecteur n’écrit pas', assertFails(setDoc(doc(viewer, 'people/p2'), person('uv'))));
await t('lecteur ne lit pas les membres', assertFails(getDocs(collection(viewer, 'members'))));
await t('admin avec majuscules dans l’e-mail lit les membres', assertSucceeds(getDocs(collection(admin, 'members'))));
await t('éditeur écrit fiche + historique', (async () => {
  const b = writeBatch(editor); b.set(doc(editor, 'people/p2'), person('ue')); b.set(doc(collection(editor, 'history')), hist('ue', 'editor@x.fr'));
  return assertSucceeds(b.commit());
})());
await t('éditeur : updatedBy d’un autre refusé', assertFails(setDoc(doc(editor, 'people/p3'), person('autre'))));
await t('éditeur : champ inconnu refusé', assertFails(setDoc(doc(editor, 'people/p3'), { ...person('ue'), admin: true })));
await t('éditeur : prénom vide refusé', assertFails(setDoc(doc(editor, 'people/p3'), { ...person('ue'), firstName: '' })));
await t('historique signé par un autre refusé', assertFails(setDoc(doc(editor, 'history/h1'), hist('autre', 'editor@x.fr'))));
await t('historique avec faux e-mail refusé', assertFails(setDoc(doc(editor, 'history/h1'), hist('ue', 'admin@x.fr'))));
await t('historique valide', assertSucceeds(setDoc(doc(editor, 'history/h1'), hist('ue', 'editor@x.fr'))));
await t('historique non modifiable', assertFails(updateDoc(doc(editor, 'history/h1'), { label: 'y' })));
await t('historique non supprimable (admin)', assertFails(deleteDoc(doc(admin, 'history/h1'))));
await t('éditeur supprime une fiche', assertSucceeds(deleteDoc(doc(editor, 'people/p2'))));
await t('éditeur ne gère pas les membres', assertFails(setDoc(doc(editor, 'members/new@x.fr'), { role: 'admin' })));
await t('admin ajoute un membre', assertSucceeds(setDoc(doc(admin, 'members/new@x.fr'), { role: 'viewer', addedBy: 'admin@x.fr' })));
await t('admin : e-mail en majuscules refusé', assertFails(setDoc(doc(admin, 'members/New@x.fr'), { role: 'viewer' })));
await t('admin : rôle inconnu refusé', assertFails(setDoc(doc(admin, 'members/new@x.fr'), { role: 'boss' })));
await t('admin ne se retire pas', assertFails(deleteDoc(doc(admin, 'members/admin@x.fr'))));
await t('admin ne se rétrograde pas', assertFails(setDoc(doc(admin, 'members/admin@x.fr'), { role: 'viewer' })));
await t('admin retire un membre', assertSucceeds(deleteDoc(doc(admin, 'members/new@x.fr'))));
await t('écriture groupée de 200 fiches + historique', (async () => {
  const b = writeBatch(editor);
  for (let i = 0; i < 200; i++) b.set(doc(editor, 'people/bulk' + i), person('ue'));
  b.set(doc(collection(editor, 'history')), hist('ue', 'editor@x.fr', 200));
  return assertSucceeds(b.commit());
})());
const img = 'data:image/jpeg;base64,' + 'A'.repeat(20000);
const photo = (uid, data = img) => ({ data, personId: 'p1', by: uid, at: serverTimestamp() });
await t('lieu de décès accepté', assertSucceeds(setDoc(doc(editor, 'people/p6'), { ...person('ue'), deathPlace: 'Lyon' })));
await t('lieu de décès trop long refusé', assertFails(setDoc(doc(editor, 'people/p6'), { ...person('ue'), deathPlace: 'x'.repeat(201) })));
await t('autres prénoms acceptés', assertSucceeds(setDoc(doc(editor, 'people/p7'), { ...person('ue'), middleNames: 'Pierre Daniel' })));
await t('fiche avec photo acceptée', assertSucceeds(setDoc(doc(editor, 'people/p5'), { ...person('ue'), photo: 'ph123' })));
await t('identifiant de photo trop long refusé', assertFails(setDoc(doc(editor, 'people/p5'), { ...person('ue'), photo: 'x'.repeat(65) })));
await t('éditeur ajoute une photo', assertSucceeds(setDoc(doc(editor, 'photos/ph1'), photo('ue'))));
await t('lecteur lit une photo', assertSucceeds(getDoc(doc(viewer, 'photos/ph1'))));
await t('non-membre ne lit pas une photo', assertFails(getDoc(doc(stranger, 'photos/ph1'))));
await t('lecteur n’ajoute pas de photo', assertFails(setDoc(doc(viewer, 'photos/ph2'), photo('uv'))));
await t('photo non modifiable', assertFails(setDoc(doc(editor, 'photos/ph1'), photo('ue'))));
await t('photo signée par un autre refusée', assertFails(setDoc(doc(editor, 'photos/ph3'), photo('autre'))));
await t('fichier non image refusé', assertFails(setDoc(doc(editor, 'photos/ph4'), photo('ue', 'data:text/html;base64,PHNjcmlwdD4='))));
await t('photo de 250 Ko acceptée', assertSucceeds(setDoc(doc(editor, 'photos/ph6'), photo('ue', 'data:image/jpeg;base64,' + 'A/+9'.repeat(62000)))));
await t('photo trop lourde refusée', assertFails(setDoc(doc(editor, 'photos/ph5'), photo('ue', 'data:image/jpeg;base64,' + 'A'.repeat(310000)))));
await t('éditeur ne supprime pas une photo', assertFails(deleteDoc(doc(editor, 'photos/ph1'))));
await t('admin supprime une photo', assertSucceeds(deleteDoc(doc(admin, 'photos/ph1'))));
console.log(`\n${ok} réussis, ${ko} échoués`);
await env.cleanup();
process.exit(ko ? 1 : 0);

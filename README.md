# Arbre familial

Application web d'arbre généalogique pensée pour le **smartphone** : une page HTML,
du JavaScript sans aucune dépendance, utilisable **hors ligne** et installable
sur l'écran d'accueil (PWA).

## Fonctionnalités (version de base)

- Fiche par personne : prénom, nom, sexe, date et lieu de naissance, date de décès, notes.
- Dates partielles acceptées : `24/05/1952`, `05/1952` ou `1952` (les dates impossibles comme 31/02 sont refusées).
- Parenté : père, mère, conjoint(s). Enfants et frères/sœurs sont **déduits automatiquement**.
  Les liens impossibles (être son propre ancêtre) sont bloqués.
- Liste avec recherche (insensible aux accents).
- Arbre visuel : **descendants** ou **ancêtres** d'une personne choisie.
- Bouton « + Ajouter un enfant » qui pré-remplit les parents.
- Export **JSON** (sauvegarde / partage via le menu de partage du téléphone) et import avec fusion.
- Export **GEDCOM 5.5.1**, le format standard d'échange entre logiciels de généalogie.

## Lancer l'application

Les fichiers sont statiques. En local :

```sh
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

Ouvrir `index.html` directement (file://) fonctionne aussi, mais sans le mode hors ligne.

### La mettre en ligne pour la famille (gratuit)

Le plus simple : **GitHub Pages** (Settings → Pages → branche `main`, dossier `/`).
L'application est alors accessible à une adresse `https://<compte>.github.io/family-tree/`.
Sur le téléphone : ouvrir le lien puis « Ajouter à l'écran d'accueil ».

⚠️ GitHub Pages publie un site **public** (et sur un dépôt privé, Pages demande un abonnement payant).
Seul le *code* est publié : **les données de la famille ne sont pas envoyées sur Internet**,
elles restent dans le navigateur de chaque téléphone.

## Où sont les données ? Comment les partager ?

- Les données sont stockées dans le navigateur (`localStorage`) du téléphone.
  Si on efface les données du navigateur, elles sont perdues → **exporter régulièrement** (menu ⋮).
- Partage actuel : une personne exporte le fichier JSON (WhatsApp, e-mail…), les autres l'importent.
  L'import **fusionne** : les fiches de même identifiant sont mises à jour, les nouvelles ajoutées.

### Étape suivante possible : un arbre partagé en temps réel

Pour que chacun modifie le *même* arbre, il faudra une base de données en ligne avec connexion
(par ex. Firebase ou Supabase, qui ont des offres gratuites). Le modèle de données est prêt pour cela
(identifiants uniques, conjoints enregistrés des deux côtés). À décider : qui peut modifier, et la
protection des données des personnes vivantes (RGPD).

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de la page, formulaires |
| `style.css` | Mise en page mobile, mode sombre, arbre en CSS pur |
| `app.js` | Données, parenté, rendu, export/import, GEDCOM |
| `manifest.webmanifest`, `icon.svg` | Installation sur l'écran d'accueil |
| `sw.js` | Service worker (fonctionnement hors ligne) |

Format d'une personne (JSON) :

```json
{ "id": "p…", "firstName": "Jean", "lastName": "Martin", "sex": "M",
  "birthDate": "1930-04-12", "birthPlace": "Lyon", "deathDate": "",
  "fatherId": "", "motherId": "", "spouseIds": ["p…"], "notes": "" }
```

## Références

- [family-chart (donatso)](https://github.com/donatso/family-chart) — bibliothèque D3 open source (MIT) pour des arbres interactifs ; candidate si l'on veut un affichage plus riche (zoom, édition dans l'arbre).
- [js-family-tree](https://github.com/c2-mrinal/js-family-tree) — alternative plus légère.
- [GEDCOM (Wikipédia)](https://en.wikipedia.org/wiki/GEDCOM) et [errata GEDCOM 5.5.1 (gedcom.io)](https://gedcom.io/gedcom551-errata/) — format d'échange : les liens passent par des enregistrements `FAM` (HUSB / WIFE / CHIL).
- [webtrees](https://webtrees.net/) et [Gramps](https://gramps-project.org/) — logiciels open source de référence, à envisager si le projet grandit (webtrees = site familial partagé avec comptes, mais nécessite un hébergement PHP).
- PWA : manifeste + service worker + HTTPS sont nécessaires pour l'installation et le mode hors ligne ([MDN – Progressive web apps](https://developer.mozilla.org/fr/docs/Web/Progressive_web_apps)).

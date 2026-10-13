# 🍪 Qui me suit ? (technologie 4e)

**En ligne : https://mberteloot.github.io/4e-qui-me-suit/**

Navigateur **simulé** façon Lightbeam, pour des élèves de 4e (activité « Mes données sur le web », parties
« Combien de cookies ? » et « Mes cookies dans Chrome ») : l'élève visite de vrais sites depuis une barre de
favoris, choisit dans le bandeau cookies (« Tout accepter » / « Continuer sans accepter », ou « Je m'abonne » /
« J'accepte » sur un mur payant), et voit **en direct** son bocal à cookies se remplir et la **toile des
traqueurs** se construire.

## Pourquoi une simulation

Une page web ne peut pas lire les cookies des autres sites (sécurité du navigateur) : seule une extension
Chrome le peut, et les Chromebooks élèves ne permettent pas d'en installer. Les données ne sont pas inventées :
elles ont été **relevées sur les vrais sites** avec Google Chrome (profil vierge, depuis Hong Kong) par
`outils/capturer-sites.js`, dans les deux situations (refus / acceptation).

Relevé du 2026-10-12 (refus → acceptation) : Le Monde 10 → 424 cookies, Marmiton 3 → 333,
Allociné 15 → 316 et jeuxvideo.com 12 → 279 (murs payants à 2 €/mois), Doctissimo 2 → 315, Wikipédia 11 sans bandeau.
Twitch, The Weather Channel et SCMP déposent 80 à 230 cookies **sans rien demander** (depuis Hong Kong, le RGPD
ne s'applique pas). Même après avoir « payé » sur Allociné, un site tiers publicitaire (Pubstack) est contacté.

## Ce que fait l'élève

- **Navigue** : 18 sites (jeux, vidéo, réseaux sociaux, actualité, recettes, santé, sites de HK).
- **Bocal** : cookies (un cookie de traqueur revu sur un autre site n'est compté qu'une fois), cookies tiers, sites tiers.
- **Toile** : gros ronds = sites visités, petits ronds = sites tiers, colorés par catégorie (publicité/pistage,
  mesure d'audience, réseau social, technique). Clic → entreprise, catégorie, sites qui l'ont contacté ; clic dans
  le vide ou Échap → tout réafficher. Zoom (boutons, Ctrl + molette, pincement du pavé tactile) et déplacement en
  faisant glisser. Filtre « présents sur au moins 2 sites ».
- **Revisite** : pas de bandeau, « le site se souvient de ton choix grâce à un cookie » ; **🧹 Effacer mes cookies** remet à zéro.
- **Statistiques** : histogramme des durées de vie, cookie record, entreprise qui suit sur le plus de sites
  (question puis classement), tableau des sites visités, liste des cookies d'un site (comme Cookie-Editor).
- **7 défis**, score flottant animé. Progression gardée dans le navigateur (`localStorage`), aucune donnée élève collectée.

## Publication

GitHub Pages, branche `main`, dossier `/docs`. Le site marche aussi en ouvrant `docs/index.html` depuis le disque.

## Refaire le relevé (1 fois par an : les sites changent souvent)

```
cd outils
npm install
# liste Disconnect : https://raw.githubusercontent.com/disconnectme/disconnect-tracking-protection/master/services.json
node capturer-sites.js chemin/vers/services.json [chemin/vers/chrome.exe] [dossier de captures d'écran]
node tester.js
```

- Le 3e argument (facultatif) enregistre une capture d'écran des sites où aucun bouton « accepter » n'a été trouvé,
  pour ajouter un sélecteur dans `SELECTEURS_ACCEPTER` (ex. mur payant Webedia : `.jad_cmp_paywall_button-cookies`,
  texte « J'accepte » ajouté en CSS).
- Les sites qui bloquent les robots (L'Équipe, Fortnite, Amazon…) sont ignorés automatiquement ; TikTok bloque parfois.
- La liste des sites est dans `SITES` (titre, catégorie, couleur de la page simulée).

## Structure

```
docs/index.html, style.css, app.js   ← l'appli (aucune bibliothèque, aucune requête réseau)
docs/data/sites.js                   ← relevé généré (window.SITES_COOKIES), ne pas éditer
outils/capturer-sites.js             ← relevé avec Chrome (puppeteer-core) + classement Disconnect (tldts)
outils/tester.js                     ← tests jsdom
```

## Crédits

Classement des traqueurs : liste [Disconnect](https://disconnect.me) (CC BY-NC-SA 4.0 — usage scolaire non commercial).

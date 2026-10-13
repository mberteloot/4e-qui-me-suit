// Relève, sur de vrais sites, les cookies déposés et les sites tiers contactés,
// avec un vrai Chrome (sans fenêtre), dans deux situations :
//   - « refus »   : on arrive sur le site sans toucher au bandeau cookies (≈ « Continuer sans accepter »)
//   - « accepte » : on clique sur « Tout accepter » dans le bandeau
// Chaque site est visité dans un profil vierge (comme une navigation privée).
//
//   node capturer-sites.js <services.json de Disconnect> [chemin de chrome.exe]
//
// services.json : https://raw.githubusercontent.com/disconnectme/disconnect-tracking-protection/master/services.json
// Produit ../docs/data/sites.js (à relancer 1 fois par an : les sites changent souvent).

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { getDomain } = require('tldts');

const CHROME = process.argv[3] || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DOSSIER_DEBUG = process.argv[4] || null; // captures d'écran des sites sans bandeau trouvé

// Sites proposés aux élèves : catégorie affichée + couleur de la « page » simulée
const SITES = [
  { url: 'https://fr.wikipedia.org/', titre: 'Wikipédia', categorie: 'Encyclopédie', couleur: '#5b6770' },
  { url: 'https://www.youtube.com/', titre: 'YouTube', categorie: 'Vidéo', couleur: '#ff0000' },
  { url: 'https://www.tiktok.com/', titre: 'TikTok', categorie: 'Réseau social', couleur: '#111111' },
  { url: 'https://www.roblox.com/', titre: 'Roblox', categorie: 'Jeu vidéo', couleur: '#335fff' },
  { url: 'https://www.minecraft.net/fr-fr', titre: 'Minecraft', categorie: 'Jeu vidéo', couleur: '#3c8527' },
  { url: 'https://www.twitch.tv/', titre: 'Twitch', categorie: 'Streaming', couleur: '#9146ff' },
  { url: 'https://open.spotify.com/', titre: 'Spotify', categorie: 'Musique', couleur: '#1db954' },
  { url: 'https://www.pinterest.fr/', titre: 'Pinterest', categorie: 'Images', couleur: '#e60023' },
  { url: 'https://www.jeuxvideo.com/', titre: 'jeuxvideo.com', categorie: 'Actualité jeux', couleur: '#e30613' },
  { url: 'https://www.marmiton.org/', titre: 'Marmiton', categorie: 'Recettes', couleur: '#f2795c' },
  { url: 'https://www.allocine.fr/', titre: 'AlloCiné', categorie: 'Cinéma', couleur: '#fecc00' },
  { url: 'https://www.ouest-france.fr/', titre: 'Ouest-France', categorie: 'Actualité', couleur: '#e2001a' },
  { url: 'https://www.lemonde.fr/', titre: 'Le Monde', categorie: 'Actualité', couleur: '#1a1a1a' },
  { url: 'https://www.doctissimo.fr/', titre: 'Doctissimo', categorie: 'Santé', couleur: '#e5007e' },
  { url: 'https://www.20minutes.fr/', titre: '20 Minutes', categorie: 'Actualité', couleur: '#0b6bb3' },
  { url: 'https://www.scmp.com/', titre: 'South China Morning Post', categorie: 'Actualité (HK)', couleur: '#ffca05' },
  { url: 'https://www.bbc.com/', titre: 'BBC', categorie: 'Actualité (monde)', couleur: '#b80000' },
  { url: 'https://www.weather.com/', titre: 'The Weather Channel', categorie: 'Météo', couleur: '#1b4de4' },
];

// Boutons « Tout accepter » des bandeaux les plus courants
const SELECTEURS_ACCEPTER = [
  '.jad_cmp_paywall_button-cookies', // mur payant Webedia (Allociné, jeuxvideo.com) : texte ajouté en CSS
  '#didomi-notice-agree-button', '#onetrust-accept-btn-handler', '.fc-cta-consent', '#L2AGLb',
  'button[data-testid="uc-accept-all-button"]', '#axeptio_btn_acceptAll', '.sp_choice_type_11',
  'button[title="Accept all"]', 'button[title="Tout accepter"]', '#truste-consent-button',
];
const TEXTES_ACCEPTER = /^(tout accepter|accepter tout|accepter et fermer|accepter & fermer|accepter et continuer|continuer en acceptant|j['’]accepte et je continue|accepter|j['’]accepte|accept all( cookies)?|accept( cookies)?|allow all( cookies)?|agree|i agree|i accept|yes, i agree|ok|got it|consent)$/i;

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- Disconnect
function chargerDisconnect(chemin) {
  const PRIORITE = ['Advertising', 'Analytics', 'Social', 'FingerprintingInvasive', 'FingerprintingGeneral',
    'Cryptomining', 'ConsentManagers', 'Anti-fraud', 'Content', 'Email', 'EmailAggressive'];
  const CATEGORIE = {
    Advertising: 'publicite', Analytics: 'audience', Social: 'social',
    FingerprintingInvasive: 'empreinte', FingerprintingGeneral: 'empreinte', Cryptomining: 'empreinte',
    ConsentManagers: 'technique', 'Anti-fraud': 'technique', Content: 'technique', Email: 'technique', EmailAggressive: 'technique',
  };
  const json = JSON.parse(fs.readFileSync(chemin, 'utf8'));
  const carte = new Map(); // domaine → { entreprise, categorie }
  for (const cat of PRIORITE) {
    for (const entree of json.categories[cat] || []) {
      for (const [entreprise, valeur] of Object.entries(entree)) {
        for (const [cle, domaines] of Object.entries(valeur)) {
          if (!Array.isArray(domaines)) continue; // clés annexes (« performance »…)
          for (const d of domaines) {
            if (!carte.has(d)) carte.set(d, { entreprise, categorie: CATEGORIE[cat] });
          }
        }
      }
    }
  }
  return carte;
}

// ---------------------------------------------------------------- relevé
async function cliquerAccepter(page) {
  for (const cadre of page.frames()) {
    try {
      const clic = await cadre.evaluate((selecteurs, motif) => {
        const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        for (const s of selecteurs) {
          const el = document.querySelector(s);
          if (el && visible(el)) { el.click(); return s; }
        }
        const re = new RegExp(motif, 'i');
        for (const el of document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]')) {
          const texte = (el.innerText || el.value || '').trim().replace(/\s+/g, ' ');
          if (texte.length < 40 && re.test(texte) && visible(el)) { el.click(); return texte; }
        }
        // secours : n'importe quel élément « feuille » portant exactement le texte (div, span cliquables…)
        for (const el of document.querySelectorAll('body *')) {
          if (el.childElementCount > 1) continue;
          const texte = (el.innerText || '').trim().replace(/\s+/g, ' ');
          if (texte.length < 25 && re.test(texte) && visible(el)) { el.click(); return texte + ' (élément ' + el.tagName.toLowerCase() + ')'; }
        }
        return null;
      }, SELECTEURS_ACCEPTER, TEXTES_ACCEPTER.source);
      if (clic) return clic;
    } catch (e) { /* cadre détaché ou interdit */ }
  }
  return null;
}

async function faireDefiler(page) {
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight)).catch(() => {});
    await pause(800);
  }
}

function resumerCookies(cookies, maintenant) {
  return cookies.map((c) => ({
    nom: c.name,
    domaine: c.domain.replace(/^\./, ''),
    // durée de vie en jours (null = cookie de session, effacé à la fermeture du navigateur)
    jours: c.expires > 0 ? Math.max(0, Math.round((c.expires - maintenant) / 86400 * 10) / 10) : null,
    taille: c.size,
  }));
}

async function relever(navigateur, site) {
  const contexte = await navigateur.createBrowserContext();
  const page = await contexte.newPage();
  await page.setViewport({ width: 1366, height: 800 });
  await page.setUserAgent((await navigateur.userAgent()).replace('HeadlessChrome', 'Chrome'));
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8' });

  const hotes = new Set();
  page.on('request', (r) => { try { hotes.add(new URL(r.url()).hostname); } catch (e) { /* data: etc. */ } });
  const client = await page.createCDPSession();
  const lireCookies = async () => (await client.send('Network.getAllCookies')).cookies;

  let erreur = null;
  let statut = 0;
  try {
    const reponse = await page.goto(site.url, { waitUntil: 'networkidle2', timeout: 30000 });
    statut = reponse ? reponse.status() : 0;
  } catch (e) { erreur = e.message.split('\n')[0]; }
  if (statut >= 400 || /ERR_NAME_NOT_RESOLVED|ERR_CONNECTION/.test(erreur || '')) {
    await contexte.close();
    return { bloque: `accès refusé (${statut || erreur})` };
  }
  await pause(4000);
  await faireDefiler(page);
  await pause(2000);

  const maintenant = Date.now() / 1000;
  const refus = { cookies: await lireCookies(), hotes: new Set(hotes) };
  // « mur payant » : payer pour ne pas avoir de cookies publicitaires, ou accepter
  const murPayant = await page.evaluate(() =>
    Boolean(document.querySelector('.jad_cmp_paywall_content')) ||
    /je m['’]abonne|pay or (accept|consent)/i.test(document.body.innerText)).catch(() => false);
  const bouton = await cliquerAccepter(page);
  if (!bouton && DOSSIER_DEBUG) {
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await page.screenshot({ path: path.join(DOSSIER_DEBUG, new URL(site.url).hostname + '.png') }).catch(() => {});
  }
  let accepte = null;
  if (bouton) {
    await pause(5000);
    await faireDefiler(page);
    await pause(3000);
    accepte = { cookies: await lireCookies(), hotes: new Set(hotes) };
  }
  const titrePage = await page.title().catch(() => '');
  await contexte.close();
  return { refus, accepte, bouton, erreur, titrePage, maintenant, murPayant };
}

// ---------------------------------------------------------------- mise en forme
function construire(site, brut, disconnect) {
  const premier = getDomain(new URL(site.url).hostname);
  const traqueurs = {}; // domaine enregistrable → infos (partagé entre les deux situations)

  function decrire(etat) {
    if (!etat) return null;
    const tiers = new Set();
    for (const h of etat.hotes) {
      const d = getDomain(h);
      if (d && d !== premier) tiers.add(d);
    }
    const cookies = resumerCookies(etat.cookies, brut.maintenant).map((c) => {
      const d = getDomain(c.domaine) || c.domaine;
      if (d !== premier) tiers.add(d);
      return { ...c, domaine: d, tiers: d !== premier };
    });
    for (const d of tiers) {
      if (!traqueurs[d]) traqueurs[d] = disconnect.get(d) || null;
    }
    return { tiers: [...tiers].sort(), cookies };
  }

  return {
    id: premier,
    url: site.url,
    titre: site.titre,
    categorie: site.categorie,
    couleur: site.couleur,
    banniere: Boolean(brut.bouton),
    murPayant: Boolean(brut.murPayant),
    refus: decrire(brut.refus),
    accepte: decrire(brut.accepte),
    traqueurs,
  };
}

(async () => {
  const cheminDisconnect = process.argv[2];
  if (!cheminDisconnect) {
    console.error('Usage : node capturer-sites.js <services.json> [chrome.exe]');
    process.exit(1);
  }
  const disconnect = chargerDisconnect(cheminDisconnect);
  const navigateur = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--lang=fr-FR'] });
  const resultats = [];
  const infosTraqueurs = {};
  for (const site of SITES) {
    process.stdout.write(site.url.padEnd(34));
    try {
      let brut = await relever(navigateur, site);
      if (brut.bloque) { await pause(10000); brut = await relever(navigateur, site); } // 2e essai
      if (brut.bloque) { console.log('ignoré :', brut.bloque); continue; }
      const r = construire(site, brut, disconnect);
      Object.assign(infosTraqueurs, r.traqueurs);
      delete r.traqueurs;
      const nb = (e) => (e ? `${e.cookies.length} cookies, ${e.tiers.length} tiers` : '—');
      console.log(`refus : ${nb(r.refus)} | accepte : ${nb(r.accepte)}${brut.bouton ? ' [' + brut.bouton + ']' : ''}${brut.murPayant ? ' MUR PAYANT' : ''}${brut.erreur ? ' ⚠ ' + brut.erreur : ''} « ${brut.titrePage.slice(0, 40)} »`);
      resultats.push(r);
    } catch (e) {
      console.log('ÉCHEC', e.message.split('\n')[0]);
    }
  }
  await navigateur.close();

  // on ne garde que les infos des domaines tiers rencontrés
  const traqueurs = {};
  for (const [d, infos] of Object.entries(infosTraqueurs)) traqueurs[d] = infos || { entreprise: null, categorie: 'inconnu' };

  const date = new Date().toISOString().slice(0, 10);
  const contenu =
    '// Généré par outils/capturer-sites.js — ne pas modifier à la main.\n' +
    '// Relevé avec Google Chrome depuis Hong Kong, chaque site dans un profil vierge.\n' +
    '// Classement des traqueurs : liste Disconnect (CC BY-NC-SA 4.0, https://disconnect.me).\n' +
    'window.SITES_COOKIES = ' + JSON.stringify({ date, sites: resultats, traqueurs }) + ';\n';
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'data', 'sites.js'), contenu);
  console.log(`\nsites.js : ${resultats.length} sites, ${Object.keys(traqueurs).length} domaines tiers, ${(contenu.length / 1024).toFixed(0)} Ko`);
})();

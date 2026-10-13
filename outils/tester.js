// Tests automatiques de « Qui me suit ? » dans un navigateur simulé (jsdom).
//
//   cd outils && npm install && node tester.js

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SITE = path.join(__dirname, '..', 'docs');
let echecs = 0;
function verifier(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { echecs++; console.log('  ÉCHEC  ' + message); }
}
const attendre = (ms = 30) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8').replace(/<script src="[^"]+"><\/script>/g, '');
  const dom = new JSDOM(html, { virtualConsole: new VirtualConsole(), runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://exemple.github.io/' });
  const w = dom.window;
  w.confirm = () => true;
  w.TOILE_RAPIDE = true;
  w.eval(fs.readFileSync(path.join(SITE, 'data', 'sites.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(SITE, 'app.js'), 'utf8'));
  const d = w.document;
  const D = w.SITES_COOKIES;
  const texte = (id) => d.getElementById(id).textContent.replace(/\s+/g, ' ');
  const nb = (id) => Number(texte(id).replace(/\s/g, '').replace(/ /g, ''));
  const clic = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const visiter = async (id, choix) => {
    clic(d.querySelector(`[data-site="${id}"]`));
    await attendre(80);
    if (choix) {
      const bouton = d.querySelector(`[data-choix="${choix}"]`);
      if (!bouton) return false;
      clic(bouton);
    }
    // attendre la fin de la visite (animations de la toile et du bocal)
    for (let i = 0; i < 200 && d.body.classList.contains('visite-en-cours'); i++) await attendre(25);
    return true;
  };
  const avecBandeau = D.sites.filter((s) => s.accepte && !s.murPayant);
  const sansBandeau = D.sites.filter((s) => !s.accepte);
  const payant = D.sites.find((s) => s.murPayant && s.accepte);

  console.log('Données');
  verifier(D.sites.length >= 12, `${D.sites.length} sites relevés`);
  verifier(avecBandeau.length >= 3, `${avecBandeau.length} sites avec bandeau « Tout accepter » : ${avecBandeau.map((s) => s.id).join(', ')}`);
  verifier(Boolean(payant), 'au moins un site à mur payant capté : ' + (payant ? payant.id : 'aucun'));
  verifier(d.querySelectorAll('.favori').length === D.sites.length, 'un favori par site');

  console.log('Site sans bandeau');
  const sobre = sansBandeau.slice().sort((a, b) => a.refus.tiers.length - b.refus.tiers.length)[0];
  await visiter(sobre.id);
  verifier(nb('bocal-cookies') === sobre.refus.cookies.length, `${sobre.id} : ${sobre.refus.cookies.length} cookies dans le bocal`);
  verifier(/RGPD/.test(texte('ecran')), 'message « ne t\'a pas demandé ton avis » (RGPD)');
  verifier(d.querySelectorAll('.noeud-site').length === 1, 'un site dans la toile');

  console.log('Bandeau : refuser, revenir, effacer, accepter');
  const cible = avecBandeau.slice().sort((a, b) => b.accepte.cookies.length - a.accepte.cookies.length)[0];
  verifier(await visiter(cible.id, 'refus'), `${cible.id} : bandeau affiché, « Continuer sans accepter »`);
  const apresRefus = nb('bocal-cookies');
  await visiter(cible.id);
  verifier(/se souvient de ton choix/.test(texte('ecran')) && nb('bocal-cookies') === apresRefus, 'revisite : pas de bandeau, le site se souvient du choix');
  clic(d.getElementById('effacer'));
  await attendre();
  verifier(nb('bocal-cookies') === 0 && d.querySelectorAll('.noeud').length === 0, 'Effacer mes cookies : bocal et toile vides');
  await visiter(cible.id, 'accepte');
  verifier(nb('bocal-cookies') === cible.accepte.cookies.length, `${cible.id} accepté : ${cible.accepte.cookies.length} cookies`);
  verifier(/Refuser ou accepter/.test(texte('comparaisons')), 'comparaison refus/acceptation affichée : ' + texte('comparaisons').slice(0, 120));
  verifier(d.querySelectorAll('.noeud-tiers').length === cible.accepte.tiers.length, `${cible.accepte.tiers.length} sites tiers dans la toile`);

  console.log('Toile et traqueurs communs');
  const autres = avecBandeau.filter((s) => s !== cible).slice(0, 2);
  for (const s of autres) await visiter(s.id, 'accepte');
  const commun = [...d.querySelectorAll('.noeud-tiers')].find((n) => /relié à [3-9]/.test(n.querySelector('title').textContent));
  verifier(Boolean(commun), 'un site tiers est relié à 3 sites : ' + (commun ? commun.dataset.noeud : '—'));
  if (commun) {
    clic(commun);
    verifier(/la même personne/.test(texte('detail')), 'détail : « la même personne a visité tous ces sites »');
    console.log('     →', texte('detail').slice(0, 140));
    clic(d.getElementById('toile'));
    verifier(d.getElementById('detail').hidden && !d.getElementById('toile').classList.contains('avec-selection')
      && !d.querySelector('#toile .eclaire'), 'clic dans le vide de la toile → sélection relâchée, toute la carte visible');
    clic(commun);
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    verifier(d.getElementById('detail').hidden, 'touche Échap → sélection relâchée');
  }
  clic(d.getElementById('zoom-plus'));
  clic(d.getElementById('zoom-plus'));
  verifier(/scale\(1\.960\)/.test(d.getElementById('vue').getAttribute('transform')) && d.getElementById('toile').classList.contains('zoom-proche') === false,
    'deux clics sur + → zoom × 1,96');
  clic(d.getElementById('zoom-plus'));
  verifier(d.getElementById('toile').classList.contains('zoom-proche'), 'zoom fort → tous les noms affichés (zoom-proche)');
  for (let i = 0; i < 20; i++) clic(d.getElementById('zoom-plus'));
  verifier(/scale\(6\.000\)/.test(d.getElementById('vue').getAttribute('transform')), 'zoom limité à × 6');
  clic(d.getElementById('zoom-recentrer'));
  verifier(/translate\(0\.0,0\.0\) scale\(1\.000\)/.test(d.getElementById('vue').getAttribute('transform')), '⟲ → retour à la vue d\'ensemble');
  d.getElementById('filtre-partages').checked = true;
  d.getElementById('filtre-partages').dispatchEvent(new w.Event('change'));
  verifier(d.querySelectorAll('.noeud-tiers.masque').length > 0, 'filtre « au moins 2 sites » masque des nœuds');

  console.log('Mur payant');
  if (payant) {
    verifier(await visiter(payant.id, 'abonne'), `${payant.id} : mur payant, « Je m'abonne »`);
    verifier(/Payé/.test(texte('ecran')), 'résumé « Payé (sans pub) »');
  }

  console.log('Statistiques');
  for (const s of D.sites.filter((x) => !d.querySelector(`[data-site="${x.id}"]`).classList.contains('visite')).slice(0, 3)) {
    await visiter(s.id, s.accepte ? 'refus' : null);
  }
  verifier(d.querySelectorAll('.histo-colonne').length === 6, 'histogramme des durées de vie (6 tranches)');
  verifier(/Cookie record/.test(texte('record')), texte('record').slice(0, 120));
  const select = d.getElementById('choix-entreprise');
  verifier(Boolean(select), 'question « quelle entreprise » après 5 sites');
  if (select) {
    // on teste toutes les réponses jusqu'à la bonne
    for (const option of [...select.options].slice(1)) {
      select.value = option.value;
      d.getElementById('form-entreprise').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
      if (!d.getElementById('entreprises').hidden) { console.log('     → entreprise :', option.value); break; }
    }
    verifier(!d.getElementById('entreprises').hidden && /Bien vu/.test(texte('question-entreprise')), 'bonne entreprise trouvée → classement affiché');
  }
  clic(d.querySelector(`[data-cookies="${cible.id}"]`));
  const longue = [...d.querySelectorAll('.ligne-cookie')].find((l) => /an/.test(l.lastElementChild.textContent));
  verifier(Boolean(longue), 'liste des cookies avec au moins un cookie de plus d\'un an');
  if (longue) {
    clic(longue);
    verifier(/Plus d'un an/.test(texte('message-cookie')), 'clic sur ce cookie → message « plus d\'un an »');
  }

  await attendre(5000); // les gains s'affichent l'un après l'autre
  const reussis = d.querySelectorAll('#defis li.reussi').length;
  verifier(reussis === 7, `${reussis}/7 défis réussis, score ${texte('score')}`);

  clic(d.getElementById('recommencer'));
  await attendre();
  verifier(texte('score') === '0' && nb('bocal-cookies') === 0 && !d.querySelector('#defis li.reussi'), 'Tout recommencer');

  console.log(echecs ? `\n${echecs} échec(s)` : '\nTout est bon ✅');
  process.exit(echecs ? 1 : 0);
})();

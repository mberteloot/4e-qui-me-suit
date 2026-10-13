// Qui me suit ? — navigateur simulé façon Lightbeam : cookies et traqueurs de vrais sites,
// relevés avec Chrome (data/sites.js), rejoués en direct. Aucune bibliothèque, aucune requête réseau.
(function () {
  'use strict';

  const DONNEES = window.SITES_COOKIES;
  const CLE_STOCKAGE = 'qui-me-suit-v1';
  const DELAI = window.TOILE_RAPIDE ? 0 : 1; // multiplicateur des animations (0 pour les tests)

  // Couleurs validées (daltonisme, contraste) : 3 catégories + un gris neutre
  const CATEGORIES = {
    publicite: { nom: 'Publicité ciblée et pistage', couleur: '#eb6834' },
    audience: { nom: 'Mesure d\'audience', couleur: '#1baf7a' },
    social: { nom: 'Réseau social', couleur: '#2a78d6' },
    technique: { nom: 'Technique, contenu ou non classé', couleur: '#a8a7a1' },
  };

  const DEFIS = [
    { id: 'commun', texte: 'Visite 3 sites, puis clique dans la toile sur un site tiers relié à 3 sites ou plus', points: 15 },
    { id: 'comparer', texte: 'Visite un même site une fois en refusant et une fois en acceptant les cookies (efface tes cookies entre les deux)', points: 20 },
    { id: 'payant', texte: 'Trouve un site qui propose de payer pour éviter les cookies publicitaires', points: 10 },
    { id: 'sobre', texte: 'Trouve un site qui contacte moins de 3 sites tiers', points: 10 },
    { id: 'longue-vie', texte: 'Dans la liste des cookies d\'un site, clique sur un cookie qui dure plus d\'un an', points: 10 },
    { id: 'entreprise', texte: 'Après 5 sites visités, trouve l\'entreprise qui t\'a suivi sur le plus de sites', points: 15 },
    { id: 'cinq-cents', texte: 'Remplis ton bocal avec plus de 500 cookies', points: 10 },
  ];

  const CHOIX = {
    accepte: 'Tout accepté',
    refus: 'Refusé',
    abonne: 'Payé (sans pub)',
    'sans-bandeau': 'Pas de question',
  };

  // =========================================================================
  // Petits outils
  // =========================================================================

  const $ = (id) => document.getElementById(id);
  const pause = (ms) => new Promise((r) => setTimeout(r, ms * DELAI));

  function echapper(texte) {
    return String(texte).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function nombre(n) {
    return n.toLocaleString('fr-FR');
  }

  function dureeLisible(jours) {
    if (jours === null) return 'Session (effacé à la fermeture)';
    if (jours < 1) return 'moins d\'un jour';
    if (jours < 31) return Math.round(jours) + ' jour' + (Math.round(jours) > 1 ? 's' : '');
    if (jours < 365) return Math.round(jours / 30.4) + ' mois';
    const ans = Math.floor(jours / 365);
    const mois = Math.round((jours - ans * 365) / 30.4);
    return ans + ' an' + (ans > 1 ? 's' : '') + (mois ? ' et ' + mois + ' mois' : '');
  }

  const siteParId = new Map(DONNEES.sites.map((s) => [s.id, s]));

  function categorieDe(domaine) {
    const t = DONNEES.traqueurs[domaine];
    if (!t) return 'technique';
    if (t.categorie === 'empreinte') return 'publicite';
    return CATEGORIES[t.categorie] ? t.categorie : 'technique';
  }

  function entrepriseDe(domaine) {
    const t = DONNEES.traqueurs[domaine];
    return (t && t.entreprise) || null;
  }

  // Données relevées pour un site selon le choix fait dans le bandeau
  function donneesVisite(site, mode) {
    return mode === 'accepte' && site.accepte ? site.accepte : site.refus;
  }

  // =========================================================================
  // État : points, défis, visites depuis le dernier « Effacer mes cookies »
  // =========================================================================

  function etatVide() {
    return { points: 0, defis: [], visites: [], comparaisons: {}, entrepriseRepondue: false };
  }

  let etat = etatVide();
  try {
    const sauve = JSON.parse(localStorage.getItem(CLE_STOCKAGE));
    if (sauve && typeof sauve.points === 'number') etat = { ...etatVide(), ...sauve };
    etat.visites = etat.visites.filter((v) => siteParId.has(v.id)); // données mises à jour entre-temps
  } catch (e) { /* stockage indisponible */ }

  function sauvegarder() {
    try { localStorage.setItem(CLE_STOCKAGE, JSON.stringify(etat)); } catch (e) { /* tant pis */ }
  }

  // Le « bocal » = tous les cookies des visites (un même cookie n'est compté qu'une fois)
  function calculerBocal(visites) {
    const cookies = new Map();
    const liens = new Map(); // domaine tiers → ensemble des sites visités qui l'ont contacté
    for (const v of visites) {
      const site = siteParId.get(v.id);
      const d = donneesVisite(site, v.mode);
      // Un même cookie de traqueur (même domaine, même nom) revu sur un autre site n'est compté
      // qu'une fois ; mais deux cookies homonymes d'une même visite (sous-domaines différents) comptent deux fois.
      const occurrences = new Map();
      for (const c of d.cookies) {
        const base = c.domaine + '|' + c.nom;
        const n = occurrences.get(base) || 0;
        occurrences.set(base, n + 1);
        const cle = base + '#' + n;
        if (!cookies.has(cle)) cookies.set(cle, { ...c, site: v.id });
      }
      for (const t of d.tiers) {
        if (!liens.has(t)) liens.set(t, new Set());
        liens.get(t).add(v.id);
      }
    }
    let tiers = 0;
    for (const c of cookies.values()) if (c.tiers) tiers++;
    return { cookies, liens, tiers };
  }

  // =========================================================================
  // Score animé (bulle « +10 » et compteur qui défile)
  // =========================================================================

  let scoreAffiche = etat.points;
  let gainsEnAttente = 0;

  function ajouterPoints(n, icone) {
    if (!n) return;
    etat.points += n;
    const delai = gainsEnAttente++ * 450;
    setTimeout(() => { gainsEnAttente--; animerGain(n, icone); }, delai);
  }

  function animerGain(n, icone) {
    const boite = $('boite-score');
    const bulle = document.createElement('span');
    bulle.className = 'bulle-gain';
    bulle.textContent = '+' + n + (icone ? ' ' + icone : '');
    bulle.addEventListener('animationend', () => bulle.remove());
    setTimeout(() => bulle.remove(), 2000);
    boite.appendChild(bulle);
    const depart = scoreAffiche;
    const arrivee = scoreAffiche + n;
    scoreAffiche = arrivee;
    const debut = performance.now();
    const pas = (t) => {
      const avancement = Math.min(1, (t - debut) / 600);
      $('score').textContent = Math.round(depart + (arrivee - depart) * avancement);
      if (avancement < 1) requestAnimationFrame(pas);
    };
    requestAnimationFrame(pas);
    setTimeout(() => { $('score').textContent = Math.max(arrivee, Number($('score').textContent)); }, 700);
    boite.classList.remove('bonus');
    void boite.offsetWidth;
    boite.classList.add('bonus');
  }

  function reussirDefi(id) {
    if (etat.defis.includes(id)) return;
    etat.defis.push(id);
    ajouterPoints(DEFIS.find((d) => d.id === id).points, '🏆');
    afficherDefis(id);
  }

  function afficherDefis(nouveau) {
    $('defis').innerHTML = DEFIS.map((d) => {
      const classes = [etat.defis.includes(d.id) ? 'reussi' : '', d.id === nouveau ? 'vient-de-reussir' : ''].join(' ');
      return `<li class="${classes}">${echapper(d.texte)}<span class="points">+${d.points} pts</span></li>`;
    }).join('');
  }

  // =========================================================================
  // La toile (graphe à forces, façon Lightbeam)
  // =========================================================================

  const SVG = 'http://www.w3.org/2000/svg';
  const LARGEUR = 1000;
  const HAUTEUR = 560;
  const toile = { noeuds: new Map(), liens: [], alpha: 0, anime: false, selection: null };

  function creerSvg(nom, attributs) {
    const el = document.createElementNS(SVG, nom);
    for (const [k, v] of Object.entries(attributs || {})) el.setAttribute(k, v);
    return el;
  }

  function initialiserToile() {
    const svg = $('toile');
    svg.setAttribute('viewBox', `0 0 ${LARGEUR} ${HAUTEUR}`);
    svg.innerHTML = '';
    // tout le graphe est dans un groupe « vue » que l'on agrandit et déplace (zoom)
    const groupeVue = creerSvg('g', { id: 'vue' });
    groupeVue.appendChild(creerSvg('g', { id: 'calque-liens' }));
    groupeVue.appendChild(creerSvg('g', { id: 'calque-noeuds' }));
    svg.appendChild(groupeVue);
    toile.noeuds.clear();
    toile.liens = [];
    toile.selection = null;
    $('detail').hidden = true;
    $('toile-vide').hidden = false;
    reinitialiserVue();
  }

  function rayon(noeud) {
    return noeud.type === 'site' ? 20 : Math.min(4 + noeud.sites.size * 2.2, 16);
  }

  function ajouterSiteToile(site) {
    if (toile.noeuds.has(site.id)) return toile.noeuds.get(site.id);
    const n = toile.noeuds.size;
    const angle = n * 2.4;
    const noeud = {
      id: site.id, type: 'site', site, sites: new Set([site.id]),
      x: LARGEUR / 2 + Math.cos(angle) * 160, y: HAUTEUR / 2 + Math.sin(angle) * 120, vx: 0, vy: 0,
    };
    const g = creerSvg('g', { class: 'noeud noeud-site', 'data-noeud': site.id, tabindex: 0, role: 'button' });
    g.appendChild(creerSvg('circle', { r: 20, fill: '#1c2340' }));
    const initiale = creerSvg('text', { class: 'initiale', 'text-anchor': 'middle', dy: '0.35em' });
    initiale.textContent = site.titre.replace(/^(L'|Le |The )/, '').charAt(0).toUpperCase();
    const etiquette = creerSvg('text', { class: 'etiquette-site', 'text-anchor': 'middle', y: 36 });
    etiquette.textContent = site.titre;
    g.append(initiale, etiquette);
    g.insertBefore(creerSvg('title'), g.firstChild).textContent = site.titre + ' (site visité)';
    noeud.el = g;
    $('calque-noeuds').appendChild(g);
    toile.noeuds.set(site.id, noeud);
    $('toile-vide').hidden = true;
    return noeud;
  }

  function ajouterTiersToile(domaine, noeudSite) {
    let noeud = toile.noeuds.get(domaine);
    if (!noeud) {
      const categorie = categorieDe(domaine);
      noeud = {
        id: domaine, type: 'tiers', categorie, sites: new Set(),
        x: noeudSite.x + (Math.random() - 0.5) * 80, y: noeudSite.y + (Math.random() - 0.5) * 80, vx: 0, vy: 0,
      };
      const g = creerSvg('g', { class: 'noeud noeud-tiers nouveau', 'data-noeud': domaine, 'data-categorie': categorie });
      g.appendChild(creerSvg('title'));
      g.appendChild(creerSvg('circle', { r: 5, fill: CATEGORIES[categorie].couleur }));
      const etiquette = creerSvg('text', { class: 'etiquette-tiers', 'text-anchor': 'middle' });
      g.appendChild(etiquette);
      noeud.el = g;
      $('calque-noeuds').insertBefore(g, $('calque-noeuds').firstChild); // sous les sites
      toile.noeuds.set(domaine, noeud);
    }
    if (!noeud.sites.has(noeudSite.id)) {
      noeud.sites.add(noeudSite.id);
      const ligne = creerSvg('line', { class: 'lien', 'data-a': noeudSite.id, 'data-b': domaine });
      $('calque-liens').appendChild(ligne);
      toile.liens.push({ a: noeudSite, b: noeud, el: ligne });
    }
    const entreprise = entrepriseDe(domaine);
    noeud.el.querySelector('title').textContent =
      `${domaine}${entreprise ? ' — ' + entreprise : ''} · ${CATEGORIES[noeud.categorie].nom} · relié à ${noeud.sites.size} site${noeud.sites.size > 1 ? 's' : ''}`;
    noeud.el.querySelector('circle').setAttribute('r', rayon(noeud));
    const etiquette = noeud.el.querySelector('text');
    etiquette.textContent = domaine;
    etiquette.setAttribute('y', -rayon(noeud) - 5);
    noeud.el.classList.toggle('partage', noeud.sites.size >= 2);
    return noeud;
  }

  function relancerToile() {
    toile.alpha = Math.max(toile.alpha, 0.8);
    if (!toile.anime) {
      toile.anime = true;
      requestAnimationFrame(pasToile);
    }
  }

  function pasToile() {
    const noeuds = [...toile.noeuds.values()];
    const a = toile.alpha;
    // répulsion entre nœuds proches
    for (let i = 0; i < noeuds.length; i++) {
      const n1 = noeuds[i];
      const c1 = n1.type === 'site' ? 8 : 1;
      for (let j = i + 1; j < noeuds.length; j++) {
        const n2 = noeuds[j];
        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        const d2 = dx * dx + dy * dy + 0.01;
        if (d2 > 40000) continue;
        const c2 = n2.type === 'site' ? 8 : 1;
        const f = (22 * c1 * c2 * a) / d2;
        n1.vx -= dx * f; n1.vy -= dy * f;
        n2.vx += dx * f; n2.vy += dy * f;
      }
    }
    // ressorts site ↔ site tiers
    for (const l of toile.liens) {
      const dx = l.b.x - l.a.x;
      const dy = l.b.y - l.a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = ((d - 55) / d) * 0.08 * a;
      l.a.vx += dx * f * 0.15; l.a.vy += dy * f * 0.15;
      l.b.vx -= dx * f; l.b.vy -= dy * f;
    }
    // gravité vers le centre, frottements, bords
    for (const n of noeuds) {
      n.vx += (LARGEUR / 2 - n.x) * 0.015 * a;
      n.vy += (HAUTEUR / 2 - n.y) * 0.03 * a;
      n.vx *= 0.6; n.vy *= 0.6;
      const marge = n.type === 'site' ? 70 : 12;
      n.x = Math.min(LARGEUR - marge, Math.max(marge, n.x + n.vx));
      n.y = Math.min(HAUTEUR - (n.type === 'site' ? 45 : 12), Math.max(n.type === 'site' ? 30 : 12, n.y + n.vy));
      n.el.setAttribute('transform', `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
    }
    for (const l of toile.liens) {
      l.el.setAttribute('x1', l.a.x.toFixed(1)); l.el.setAttribute('y1', l.a.y.toFixed(1));
      l.el.setAttribute('x2', l.b.x.toFixed(1)); l.el.setAttribute('y2', l.b.y.toFixed(1));
    }
    toile.alpha *= 0.985;
    if (toile.alpha > 0.02) requestAnimationFrame(pasToile);
    else toile.anime = false;
  }

  function appliquerFiltre() {
    const seulementPartages = $('filtre-partages').checked;
    for (const n of toile.noeuds.values()) {
      if (n.type === 'tiers') n.el.classList.toggle('masque', seulementPartages && n.sites.size < 2);
    }
    for (const l of toile.liens) l.el.classList.toggle('masque', seulementPartages && l.b.sites.size < 2);
  }

  function legende() {
    const bocal = calculerBocal(etat.visites);
    const compte = { publicite: 0, audience: 0, social: 0, technique: 0 };
    for (const d of bocal.liens.keys()) compte[categorieDe(d)]++;
    $('legende').innerHTML =
      '<span class="legende-item"><span class="pastille pastille-site"></span>Site visité</span>' +
      Object.entries(CATEGORIES).map(([cle, c]) =>
        `<span class="legende-item"><span class="pastille" style="background:${c.couleur}"></span>${c.nom} <strong>${compte[cle]}</strong></span>`).join('');
  }

  function selectionner(id) {
    const noeud = toile.noeuds.get(id);
    if (!noeud) return;
    toile.selection = id;
    const voisins = new Set([id]);
    if (noeud.type === 'site') {
      for (const l of toile.liens) if (l.a.id === id) voisins.add(l.b.id);
    } else {
      for (const s of noeud.sites) voisins.add(s);
    }
    $('toile').classList.add('avec-selection');
    for (const n of toile.noeuds.values()) {
      n.el.classList.toggle('eclaire', voisins.has(n.id));
      n.el.classList.toggle('selectionne', n.id === id);
    }
    for (const l of toile.liens) l.el.classList.toggle('eclaire', l.a.id === id || l.b.id === id);

    const bocal = calculerBocal(etat.visites);
    let html;
    if (noeud.type === 'site') {
      const v = etat.visites.find((x) => x.id === id);
      const d = donneesVisite(noeud.site, v.mode);
      const partages = d.tiers.filter((t) => (bocal.liens.get(t) || new Set()).size >= 2).length;
      html = `<h4>🌐 ${echapper(noeud.site.titre)} <span class="discret">(${echapper(noeud.site.id)}, ${echapper(noeud.site.categorie)})</span></h4>
        <p>Ton choix : <strong>${CHOIX[v.mode]}</strong> · ${nombre(d.cookies.length)} cookies · ${nombre(d.tiers.length)} sites tiers contactés,
        dont <strong>${partages}</strong> aussi présents sur d'autres sites que tu as visités.</p>`;
    } else {
      const entreprise = entrepriseDe(id);
      const cookiesDuDomaine = [...bocal.cookies.values()].filter((c) => c.domaine === id).length;
      const noms = [...noeud.sites].map((s) => siteParId.get(s).titre);
      const cat = CATEGORIES[noeud.categorie];
      html = `<h4><span class="pastille" style="background:${cat.couleur}"></span> ${echapper(id)}</h4>
        <p>Entreprise : <strong>${entreprise ? echapper(entreprise) : 'inconnue'}</strong> · Catégorie : <strong>${cat.nom}</strong></p>
        <p>Contacté par <strong>${noms.length} site${noms.length > 1 ? 's' : ''}</strong> : ${noms.map(echapper).join(', ')}.
        ${cookiesDuDomaine ? `Il a déposé <strong>${cookiesDuDomaine} cookie${cookiesDuDomaine > 1 ? 's' : ''}</strong> dans ton bocal.` : 'Il n\'a pas déposé de cookie (il peut quand même voir ton adresse IP et la page visitée).'}</p>
        ${noms.length >= 2 ? '<p class="alerte">👁️ Ce site tiers peut savoir que <strong>la même personne</strong> a visité tous ces sites.</p>' : ''}`;
      if (noms.length >= 3) reussirDefi('commun');
    }
    $('detail').hidden = false;
    $('detail').innerHTML = html + '<button type="button" class="bouton-lien" id="fermer-detail">Fermer</button>';
    sauvegarder();
  }

  function deselectionner() {
    toile.selection = null;
    $('toile').classList.remove('avec-selection');
    for (const n of toile.noeuds.values()) n.el.classList.remove('eclaire', 'selectionne');
    for (const l of toile.liens) l.el.classList.remove('eclaire');
    $('detail').hidden = true;
  }

  // ---------------------------------------------------------------- zoom et déplacement
  // Zoom : boutons, Ctrl + molette, pincement du pavé tactile (Chrome l'envoie comme Ctrl + molette).
  // La molette seule fait toujours défiler la page. Déplacement : faire glisser le fond ou un nœud.

  const vue = { k: 1, x: 0, y: 0 };
  const ZOOM_MIN = 0.6;
  const ZOOM_MAX = 6;
  let glissement = null;
  let clicApresGlissement = false;

  function appliquerVue() {
    const groupe = $('vue');
    if (!groupe) return;
    groupe.setAttribute('transform', `translate(${vue.x.toFixed(1)},${vue.y.toFixed(1)}) scale(${vue.k.toFixed(3)})`);
    $('toile').style.setProperty('--zoom', vue.k.toFixed(3));
    $('toile').classList.toggle('zoom-proche', vue.k >= 2.2);
  }

  function reinitialiserVue() {
    vue.k = 1; vue.x = 0; vue.y = 0;
    appliquerVue();
  }

  // position de la souris dans le repère du graphe (viewBox), avant zoom
  function pointToile(e) {
    const r = $('toile').getBoundingClientRect();
    if (!r.width) return { x: LARGEUR / 2, y: HAUTEUR / 2 };
    return { x: ((e.clientX - r.left) * LARGEUR) / r.width, y: ((e.clientY - r.top) * HAUTEUR) / r.height };
  }

  function zoomer(facteur, centre) {
    const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, vue.k * facteur));
    const c = centre || { x: LARGEUR / 2, y: HAUTEUR / 2 };
    // le point sous la souris reste au même endroit
    vue.x = c.x - (c.x - vue.x) * (k / vue.k);
    vue.y = c.y - (c.y - vue.y) * (k / vue.k);
    vue.k = k;
    appliquerVue();
  }

  function brancherZoom() {
    const svg = $('toile');
    svg.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      // un cran de molette ≈ × 1,25 ; le pincement du pavé tactile envoie de petits pas, plus fluides
      zoomer(Math.min(1.25, Math.max(0.8, Math.exp(-e.deltaY * 0.004))), pointToile(e));
    }, { passive: false });

    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      glissement = { x: e.clientX, y: e.clientY, depart: { x: vue.x, y: vue.y }, bouge: false, id: e.pointerId };
    });
    svg.addEventListener('pointermove', (e) => {
      if (!glissement || e.pointerId !== glissement.id) return;
      const dx = e.clientX - glissement.x;
      const dy = e.clientY - glissement.y;
      if (!glissement.bouge && Math.hypot(dx, dy) < 5) return; // petit tremblement = simple clic
      if (!glissement.bouge) {
        glissement.bouge = true;
        try { svg.setPointerCapture(e.pointerId); } catch (err) { /* navigateur ancien */ }
        svg.classList.add('glisse');
      }
      const r = svg.getBoundingClientRect();
      const echelle = r.width ? LARGEUR / r.width : 1;
      vue.x = glissement.depart.x + dx * echelle;
      vue.y = glissement.depart.y + dy * echelle;
      appliquerVue();
    });
    const finGlissement = () => {
      if (glissement && glissement.bouge) {
        clicApresGlissement = true; // le « click » qui suit un glissement ne sélectionne rien
        setTimeout(() => { clicApresGlissement = false; }, 0);
      }
      glissement = null;
      svg.classList.remove('glisse');
    };
    svg.addEventListener('pointerup', finGlissement);
    svg.addEventListener('pointercancel', finGlissement);

    $('zoom-plus').addEventListener('click', () => zoomer(1.4));
    $('zoom-moins').addEventListener('click', () => zoomer(1 / 1.4));
    $('zoom-recentrer').addEventListener('click', reinitialiserVue);
  }

  // =========================================================================
  // Navigateur simulé
  // =========================================================================

  let visiteEnCours = false;

  function afficherFavoris() {
    const visites = new Set(etat.visites.map((v) => v.id));
    $('favoris').innerHTML = DONNEES.sites.map((s) =>
      `<button type="button" class="favori${visites.has(s.id) ? ' visite' : ''}" data-site="${echapper(s.id)}" title="${echapper(s.categorie)}">` +
      `<span class="favori-point" style="background:${s.couleur}"></span>${echapper(s.titre)}</button>`).join('');
  }

  function ecranAccueil() {
    $('onglet').textContent = 'Nouvel onglet';
    $('adresse').textContent = 'Choisis un site dans tes favoris';
    $('ecran').innerHTML = '<div class="ecran-accueil"><span aria-hidden="true">🧭</span><p>Choisis un site dans la barre de favoris pour commencer ta navigation.</p></div>';
  }

  function pageSimulee(site, contenuSuperpose) {
    return `<div class="page-simulee" style="--couleur-site:${site.couleur}">
      <div class="page-entete">${echapper(site.titre)}</div>
      <div class="page-corps" aria-hidden="true"><i></i><i></i><i class="court"></i><b></b><b></b><b></b></div>
      ${contenuSuperpose || ''}
    </div>`;
  }

  // Bandeau cookies : renvoie le choix de l'élève
  function demanderChoix(site) {
    return new Promise((resoudre) => {
      const partenaires = site.accepte ? site.accepte.tiers.length : 0;
      const bandeau = site.murPayant
        ? `<div class="bandeau bandeau-payant" role="dialog" aria-label="Bandeau cookies">
            <p class="bandeau-titre">Exprimez vos choix</p>
            <div class="bandeau-colonnes">
              <div><p><strong>Accéder au site pour 2 € par mois</strong> sans cookie publicitaire.</p><button type="button" class="bouton-secondaire" data-choix="abonne">Je m'abonne (2 €/mois)</button></div>
              <div><p><strong>… ou gratuitement</strong> en acceptant que le site et ses partenaires déposent des cookies publicitaires.</p><button type="button" class="bouton-accepter" data-choix="accepte">J'accepte</button></div>
            </div>
          </div>`
        : `<div class="bandeau" role="dialog" aria-label="Bandeau cookies">
            <p class="bandeau-titre">🍪 Nous respectons votre vie privée</p>
            <p>${echapper(site.titre)} et ses <strong>${partenaires || 'nombreux'} partenaires</strong> utilisent des cookies pour mesurer l'audience et vous proposer des publicités personnalisées.</p>
            <div class="bandeau-boutons">
              <button type="button" class="bouton-secondaire" data-choix="refus">Continuer sans accepter</button>
              <button type="button" class="bouton-accepter" data-choix="accepte">Tout accepter</button>
            </div>
          </div>`;
      $('ecran').innerHTML = pageSimulee(site, bandeau);
      $('ecran').querySelectorAll('[data-choix]').forEach((b) =>
        b.addEventListener('click', () => resoudre(b.dataset.choix), { once: true }));
    });
  }

  async function visiter(id) {
    if (visiteEnCours) return;
    const site = siteParId.get(id);
    visiteEnCours = true;
    document.body.classList.add('visite-en-cours');
    try {
      $('onglet').textContent = site.titre;
      $('adresse').textContent = site.url.replace(/^https:\/\//, '').replace(/\/$/, '');
      $('ecran').innerHTML = pageSimulee(site, '<div class="chargement">Chargement…</div>');
      await pause(500);

      const dejaVisite = etat.visites.find((v) => v.id === id);
      let mode;
      let note = '';
      if (dejaVisite) {
        mode = dejaVisite.mode;
        note = site.accepte
          ? '🔁 Pas de bandeau cette fois : le site <strong>se souvient de ton choix</strong> grâce à un cookie ! Pour changer d\'avis, efface tes cookies.'
          : '🔁 Tu reviens sur ce site : ses cookies sont déjà dans ton bocal.';
      } else if (site.accepte) {
        mode = await demanderChoix(site);
      } else {
        mode = 'sans-bandeau';
        note = '🤐 Ce site ne t\'a pas demandé ton avis. En Europe, la loi (RGPD) l\'obligerait à demander ton accord avant de déposer des cookies publicitaires ; à Hong Kong, ce n\'est pas obligatoire.';
      }
      await deposer(site, mode, note, Boolean(dejaVisite));
    } finally {
      visiteEnCours = false;
      document.body.classList.remove('visite-en-cours');
    }
  }

  async function deposer(site, mode, note, dejaVisite) {
    const d = donneesVisite(site, mode);
    const avant = calculerBocal(etat.visites);
    if (!dejaVisite) etat.visites.push({ id: site.id, mode });
    const apres = calculerBocal(etat.visites);
    const connus = d.tiers.filter((t) => avant.liens.has(t)).length;

    $('ecran').innerHTML = pageSimulee(site, '<div class="pluie" id="pluie" aria-hidden="true"></div>');
    afficherFavoris();

    // la toile se construit et le bocal se remplit en même temps
    const noeudSite = ajouterSiteToile(site);
    relancerToile();
    const duree = Math.min(2500, 300 + d.tiers.length * 25);
    const animationBocal = animerBocal(avant, apres, duree);
    lancerPluie(Math.min(18, Math.ceil((apres.cookies.size - avant.cookies.size) / 10)));
    const parPas = Math.max(1, Math.ceil(d.tiers.length / 60));
    for (let i = 0; i < d.tiers.length; i += parPas) {
      d.tiers.slice(i, i + parPas).forEach((t) => ajouterTiersToile(t, noeudSite));
      relancerToile();
      await pause(duree / Math.ceil(d.tiers.length / parPas || 1));
    }
    await animationBocal;
    appliquerFiltre();
    legende();

    const pub = d.tiers.filter((t) => categorieDe(t) === 'publicite').length;
    $('ecran').innerHTML = pageSimulee(site, `<div class="resume-visite">
        <p class="resume-titre">${echapper(site.titre)} · ${CHOIX[mode]}</p>
        <p><strong>${nombre(d.cookies.length)}</strong> cookies déposés · <strong>${nombre(d.tiers.length)}</strong> sites tiers contactés,
        dont <strong>${pub}</strong> de publicité ou de pistage.</p>
        ${connus && avant.liens.size ? `<p>👁️ <strong>${connus}</strong> de ces sites tiers t'avaient déjà vu sur un autre site : ils te reconnaissent.</p>` : ''}
        ${note ? `<p class="note">${note}</p>` : ''}
      </div>`);

    if (!dejaVisite) {
      const comparaison = etat.comparaisons[site.id] || {};
      comparaison[mode === 'accepte' ? 'accepte' : 'refus'] = d.cookies.length;
      etat.comparaisons[site.id] = comparaison;
      if (comparaison.accepte !== undefined && comparaison.refus !== undefined) reussirDefi('comparer');
    }
    if (site.murPayant) reussirDefi('payant');
    if (d.tiers.length < 3) reussirDefi('sobre');
    if (apres.cookies.size > 500) reussirDefi('cinq-cents');
    afficherStatistiques();
    afficherComparaisons();
    sauvegarder();
  }

  function animerBocal(avant, apres, duree) {
    return new Promise((resoudre) => {
      const valeurs = [
        ['bocal-cookies', avant.cookies.size, apres.cookies.size],
        ['bocal-tiers', avant.tiers, apres.tiers],
        ['bocal-sites-tiers', avant.liens.size, apres.liens.size],
      ];
      $('bocal-visites').textContent = etat.visites.length;
      const debut = performance.now();
      const pas = (t) => {
        const avancement = DELAI ? Math.min(1, (t - debut) / duree) : 1;
        for (const [id, de, a] of valeurs) $(id).textContent = nombre(Math.round(de + (a - de) * avancement));
        if (avancement < 1) requestAnimationFrame(pas);
        else resoudre();
      };
      if (!DELAI) { pas(debut); return; }
      requestAnimationFrame(pas);
      if (apres.cookies.size > avant.cookies.size) {
        const bocal = document.querySelector('.bocal');
        bocal.classList.remove('se-remplit');
        void bocal.offsetWidth;
        bocal.classList.add('se-remplit');
      }
    });
  }

  function lancerPluie(n) {
    const pluie = $('pluie');
    if (!pluie || !DELAI) return;
    for (let i = 0; i < n; i++) {
      const c = document.createElement('span');
      c.className = 'goutte';
      c.textContent = '🍪';
      c.style.left = (5 + Math.random() * 90) + '%';
      c.style.animationDelay = (Math.random() * 1.6) + 's';
      pluie.appendChild(c);
    }
  }

  function effacerCookies() {
    if (visiteEnCours) return;
    etat.visites = [];
    sauvegarder();
    initialiserToile();
    afficherFavoris();
    ['bocal-cookies', 'bocal-tiers', 'bocal-sites-tiers', 'bocal-visites'].forEach((id) => { $(id).textContent = '0'; });
    legende();
    afficherStatistiques();
    $('onglet').textContent = 'Nouvel onglet';
    $('adresse').textContent = 'Choisis un site dans tes favoris';
    $('ecran').innerHTML = '<div class="ecran-accueil"><span aria-hidden="true">🧹</span><p>Cookies effacés : les sites ne te reconnaissent plus… jusqu\'à ta prochaine visite !</p></div>';
  }

  // =========================================================================
  // Statistiques
  // =========================================================================

  const TRANCHES = [
    { nom: 'Session', test: (j) => j === null },
    { nom: '< 1 jour', test: (j) => j !== null && j < 1 },
    { nom: '1 jour à 1 mois', test: (j) => j >= 1 && j < 31 },
    { nom: '1 à 6 mois', test: (j) => j >= 31 && j < 183 },
    { nom: '6 mois à 1 an', test: (j) => j >= 183 && j <= 366 },
    { nom: 'Plus d\'un an', test: (j) => j > 366 },
  ];

  function afficherStatistiques() {
    const bocal = calculerBocal(etat.visites);
    const cookies = [...bocal.cookies.values()];

    // histogramme des durées de vie
    const comptes = TRANCHES.map((t) => cookies.filter((c) => t.test(c.jours)).length);
    const max = Math.max(1, ...comptes);
    $('histogramme').innerHTML = cookies.length
      ? '<div class="histo-barres">' + TRANCHES.map((t, i) =>
        `<div class="histo-colonne" title="${t.nom} : ${comptes[i]} cookie${comptes[i] > 1 ? 's' : ''}">
          <span class="histo-valeur">${nombre(comptes[i])}</span>
          <span class="histo-barre" style="height:${Math.round((comptes[i] / max) * 100)}%"></span>
          <span class="histo-nom">${t.nom}</span></div>`).join('') + '</div>'
      : '<p class="vide">Visite un site pour remplir ton bocal.</p>';

    const record = cookies.filter((c) => c.jours !== null).sort((a, b) => b.jours - a.jours)[0];
    $('record').innerHTML = record
      ? `🏅 Cookie record : <code>${echapper(record.nom)}</code> de <strong>${echapper(record.domaine)}</strong>, qui restera <strong>${dureeLisible(record.jours)}</strong> dans ton navigateur.`
      : '';

    // entreprises : sur combien de sites visités chacune est présente
    const parEntreprise = new Map();
    for (const [domaine, sites] of bocal.liens) {
      const e = entrepriseDe(domaine);
      if (!e) continue;
      if (!parEntreprise.has(e)) parEntreprise.set(e, new Set());
      sites.forEach((s) => parEntreprise.get(e).add(s));
    }
    const classement = [...parEntreprise.entries()].map(([e, s]) => [e, s.size]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    afficherQuestionEntreprise(classement);
    const maxE = classement.length ? classement[0][1] : 1;
    $('entreprises').innerHTML = classement.slice(0, 8).map(([e, n]) =>
      `<div class="barre-ligne" title="${echapper(e)} : présente sur ${n} site${n > 1 ? 's' : ''} visité${n > 1 ? 's' : ''}">
        <span class="barre-nom">${echapper(e)}</span>
        <span class="barre-piste"><span class="barre-remplie" style="width:${Math.round((n / maxE) * 100)}%"></span></span>
        <span class="barre-valeur">${n} site${n > 1 ? 's' : ''}</span></div>`).join('');

    // tableau des sites visités
    $('tableau-sites').innerHTML = etat.visites.length
      ? etat.visites.map((v) => {
        const s = siteParId.get(v.id);
        const d = donneesVisite(s, v.mode);
        return `<tr><td><span class="favori-point" style="background:${s.couleur}"></span>${echapper(s.titre)}</td>
          <td>${CHOIX[v.mode]}</td><td>${nombre(d.cookies.length)}</td><td>${nombre(d.tiers.length)}</td>
          <td><button type="button" class="bouton-lien" data-cookies="${echapper(s.id)}">Voir les cookies</button></td></tr>`;
      }).join('')
      : '<tr class="vide"><td colspan="5">Aucun site visité.</td></tr>';
  }

  function afficherQuestionEntreprise(classement) {
    const zone = $('question-entreprise');
    if (etat.entrepriseRepondue) {
      $('entreprises').hidden = false;
      zone.innerHTML = '<p class="explication">Nombre de sites visités sur lesquels chaque entreprise était présente :</p>';
      return;
    }
    $('entreprises').hidden = true;
    if (etat.visites.length < 5) {
      zone.innerHTML = `<p class="vide">Visite au moins 5 sites pour découvrir quelle entreprise te suit le plus (${etat.visites.length}/5).</p>`;
      return;
    }
    if (zone.querySelector('select')) return; // question déjà affichée
    const options = classement.map(([e]) => e).sort((a, b) => a.localeCompare(b));
    zone.innerHTML = `<form class="question" id="form-entreprise">
      <label for="choix-entreprise">Quelle entreprise t'a suivi sur le plus de sites ? Enquête dans la toile !</label>
      <select id="choix-entreprise"><option value="">— choisis —</option>${options.map((e) => `<option>${echapper(e)}</option>`).join('')}</select>
      <button type="submit" class="bouton-principal">Vérifier</button>
      <div id="reponse-entreprise" aria-live="polite"></div></form>`;
  }

  function verifierEntreprise() {
    const choix = $('choix-entreprise').value;
    if (!choix) return;
    const bocal = calculerBocal(etat.visites);
    const parEntreprise = new Map();
    for (const [domaine, sites] of bocal.liens) {
      const e = entrepriseDe(domaine);
      if (!e) continue;
      if (!parEntreprise.has(e)) parEntreprise.set(e, new Set());
      sites.forEach((s) => parEntreprise.get(e).add(s));
    }
    const max = Math.max(...[...parEntreprise.values()].map((s) => s.size));
    const n = parEntreprise.get(choix).size;
    if (n === max) {
      etat.entrepriseRepondue = true;
      reussirDefi('entreprise');
      afficherStatistiques();
      $('question-entreprise').insertAdjacentHTML('afterbegin', `<p class="message succes">✔ Bien vu : <strong>${echapper(choix)}</strong> était présente sur ${n} des ${etat.visites.length} sites visités !</p>`);
    } else {
      $('reponse-entreprise').innerHTML = `<p class="message erreur">${echapper(choix)} est présente sur ${n} site${n > 1 ? 's' : ''}… une autre fait mieux ! Clique sur les gros ronds de la toile.</p>`;
    }
    sauvegarder();
  }

  function afficherCookies(id) {
    const site = siteParId.get(id);
    const v = etat.visites.find((x) => x.id === id);
    if (!v) return;
    const cookies = donneesVisite(site, v.mode).cookies.slice()
      .sort((a, b) => (b.jours === null ? -1 : b.jours) - (a.jours === null ? -1 : a.jours));
    $('liste-cookies').hidden = false;
    $('liste-cookies').innerHTML = `<h4>🍪 Cookies de ${echapper(site.titre)} (${CHOIX[v.mode].toLowerCase()}) : ${nombre(cookies.length)}</h4>
      <p class="petit">Comme dans Cookie-Editor : clique sur un cookie pour l'examiner.</p>
      <div class="tableau-defilant liste-cookies-defilante"><table class="tableau">
      <thead><tr><th>Nom</th><th>Déposé par</th><th>Type</th><th>Durée de vie</th></tr></thead><tbody>` +
      cookies.map((c, i) => `<tr class="ligne-cookie" data-index="${i}" data-site-cookie="${echapper(id)}" tabindex="0">
        <td><code>${echapper(c.nom.length > 28 ? c.nom.slice(0, 26) + '…' : c.nom)}</code></td><td>${echapper(c.domaine)}</td>
        <td>${c.tiers ? '<span class="etiquette-tiers-txt">site tiers</span>' : 'le site lui-même'}</td><td>${dureeLisible(c.jours)}</td></tr>`).join('') +
      '</tbody></table></div><div id="message-cookie" aria-live="polite"></div>';
    $('liste-cookies').cookiesAffiches = cookies;
    $('liste-cookies').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function examinerCookie(ligne) {
    const c = $('liste-cookies').cookiesAffiches[Number(ligne.dataset.index)];
    document.querySelectorAll('.ligne-cookie.choisie').forEach((l) => l.classList.remove('choisie'));
    ligne.classList.add('choisie');
    let message = `<code>${echapper(c.nom)}</code> : déposé par <strong>${echapper(c.domaine)}</strong>${c.tiers ? ' (un site tiers, pas le site visité !)' : ''}, durée de vie : <strong>${dureeLisible(c.jours)}</strong>.`;
    if (c.jours > 366) {
      message += ' 📅 Plus d\'un an : ce cookie pourra te reconnaître pendant très longtemps.';
      reussirDefi('longue-vie');
      sauvegarder();
    }
    $('message-cookie').innerHTML = `<p class="message ${c.jours > 366 ? 'succes' : ''}">${message}</p>`;
  }

  function afficherComparaisons() {
    const lignes = Object.entries(etat.comparaisons)
      .filter(([, c]) => c.accepte !== undefined && c.refus !== undefined)
      .map(([id, c]) => {
        const s = siteParId.get(id);
        if (!s) return '';
        const facteur = c.refus ? Math.round(c.accepte / c.refus) : null;
        return `<div class="comparaison"><strong>${echapper(s.titre)}</strong> : ${nombre(c.refus)} cookies en refusant,
          <strong>${nombre(c.accepte)}</strong> en acceptant${facteur && facteur > 1 ? ` (<strong>× ${facteur}</strong>)` : ''}.</div>`;
      }).join('');
    $('comparaisons').innerHTML = lignes ? '<h3>⚖️ Refuser ou accepter ?</h3>' + lignes : '';
  }

  // =========================================================================
  // Branchements
  // =========================================================================

  function reconstruireDepuisEtat() {
    initialiserToile();
    for (const v of etat.visites) {
      const site = siteParId.get(v.id);
      const noeudSite = ajouterSiteToile(site);
      donneesVisite(site, v.mode).tiers.forEach((t) => ajouterTiersToile(t, noeudSite));
    }
    relancerToile();
    const bocal = calculerBocal(etat.visites);
    $('bocal-cookies').textContent = nombre(bocal.cookies.size);
    $('bocal-tiers').textContent = nombre(bocal.tiers);
    $('bocal-sites-tiers').textContent = nombre(bocal.liens.size);
    $('bocal-visites').textContent = etat.visites.length;
  }

  function initialiser() {
    $('score').textContent = etat.points;
    $('date-releve').textContent = new Date(DONNEES.date).toLocaleDateString('fr-FR');
    afficherFavoris();
    ecranAccueil();
    reconstruireDepuisEtat();
    legende();
    afficherStatistiques();
    afficherComparaisons();
    afficherDefis();

    document.addEventListener('click', (e) => {
      const favori = e.target.closest('[data-site]');
      if (favori) { visiter(favori.dataset.site); return; }
      const noeud = e.target.closest('[data-noeud]');
      if (noeud) { if (!clicApresGlissement) selectionner(noeud.dataset.noeud); return; }
      // clic dans le vide de la toile : on relâche la sélection, toute la carte redevient visible
      if (e.target.closest('#toile')) { if (!clicApresGlissement) deselectionner(); return; }
      if (e.target.id === 'fermer-detail') { deselectionner(); return; }
      const voir = e.target.closest('[data-cookies]');
      if (voir) { afficherCookies(voir.dataset.cookies); return; }
      const ligne = e.target.closest('.ligne-cookie');
      if (ligne) examinerCookie(ligne);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && toile.selection) { deselectionner(); return; }
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const noeud = e.target.closest('[data-noeud]');
      if (noeud) { e.preventDefault(); selectionner(noeud.dataset.noeud); return; }
      const ligne = e.target.closest('.ligne-cookie');
      if (ligne) { e.preventDefault(); examinerCookie(ligne); }
    });
    document.addEventListener('submit', (e) => {
      if (e.target.id === 'form-entreprise') { e.preventDefault(); verifierEntreprise(); }
    });
    $('effacer').addEventListener('click', effacerCookies);
    brancherZoom();
    $('filtre-partages').addEventListener('change', appliquerFiltre);

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([entree]) => {
        $('boite-score').classList.toggle('flottant', !entree.isIntersecting);
      }).observe(document.querySelector('.entete'));
    }

    $('recommencer').addEventListener('click', () => {
      if (!confirm('Tout recommencer (points, défis, cookies) ?')) return;
      etat = etatVide();
      sauvegarder();
      scoreAffiche = 0;
      $('score').textContent = 0;
      effacerCookies();
      ecranAccueil();
      afficherComparaisons();
      afficherDefis();
    });
  }

  initialiser();
})();

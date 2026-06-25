# CLAUDE.md — Brigade Stock (gestion de stock restaurant)

App de gestion de stock **pensée pour les restaurateurs**. Objectif produit : garder toute la
complexité métier mais rester **ultra simple à utiliser** (« pas de texte/boutons partout »).
Principe directeur : **transformer chaque donnée en une action proposée, et cacher le reste.**
Construite en binôme avec Codex — éviter d'éditer les fichiers pendant que Codex écrit.

## Stack & commandes

- React 18 + Vite + `lucide-react` (icônes). React vanilla, **pas** de lib d'animation pour l'instant.
- État persisté en `localStorage` (clé `brigade-stock-state-v4`), pas de backend.
- `npm run dev` (sert sur 127.0.0.1) · `npm run build` · `npm run preview`.
- Vérifier toute modif avec `npm run build` (doit passer sans erreur) puis, si possible, lancer l'app.

## Architecture

- `src/data.js` — données seed (ingrédients, lots, recettes, fournisseurs, check-list, logs, scénario). Le
  modèle métier est riche : par-min/max, lead time, targetDays/safetyDays, shelfLife, wasteRate,
  price/previousPrice, lots avec expiryOffset.
- `src/intelligence.js` — **moteur de calcul pur** (pas de React). `buildIntelligence(...)` produit :
  prévision 7 j, usage par ingrédient, état de stock enrichi (risques rupture/DLC/écart/prix/surstock
  + riskScore + statut), plan de commande groupé par fournisseur, insights recettes/marge, alertes,
  pertes par catégorie, KPIs (valeur stock, risque, couverture, food cost %). FEFO via
  `reduceFromOldestLots` et tri des lots par `expiryOffset`.
- `src/App.jsx` — toute l'UI. 7 onglets : Pilotage, Commandes, Stock & lots, Prévisions, Recettes,
  Autocontrôle CH, Réception. La logique métier vit dans `intelligence.js` — App.jsx ne fait que présenter + muter l'état.
- `src/styles.css` — design system (~1000 lignes). Tokens dans `:root` (`--ink --muted --line --paper
  --blue --teal --green --amber --red --violet --shadow`). Boutons : `primary-button`, `ghost-button`
  (+ `.compact`, `.strong`), `danger-button`.

## Conventions

- **UI en français**, avec accents (« Réception », « Prévisions », « DLC dépassée »…).
- Formatage via les helpers de `intelligence.js` : `money`, `preciseMoney`, `number` (Intl fr-FR).
- Garder le calcul dans `intelligence.js` (testable, pur) ; ne pas mettre de métier dans les composants.
- Icônes : importer depuis `lucide-react`, taille 16-22.
- Respecter les tokens CSS existants ; pas de couleurs en dur hors palette.

## Règles métier (à respecter)

- **FEFO** (First Expired First Out), pas FIFO : sortir par DLC réelle (`expiryOffset`).
- **Par level** = (conso moy./j × jours entre commandes) + stock sécurité ; doit se réajuster avec
  les ventes réelles, sinon il ment.
- **Écart théorie/réel** = à trier/traiter par **impact CHF**, pas par quantité.
- **Suisse/autocontrôle** : calibrer sur LDAI/ODAlOUs/OSAV, pas France. Le produit doit prouver
  l'autocontrôle utile sans capteurs: lots, réceptions, DLC/DDM, produits ouverts/préparés, actions
  correctives, pertes motivées et export de registre.
- **Traçabilité** : chaque lot doit porter fournisseur, lot, date de réception, DLC/DDM, zone et
  historique interne. Les informations doivent pouvoir être ressorties lors d'un contrôle cantonal.

## Principes UX (le cœur du produit)

1. Une action par écran ; le comptage doit être l'écran le plus rapide.
2. Le système propose, l'humain valide (panier de commande pré-rempli, alertes actionnables en 1 tap).
3. Alertes avant données : le Pilotage = « les choses à faire aujourd'hui », pas un mur de chiffres.
4. Penser mobile/offline : le comptage se fait au téléphone, en chambre froide, sans réseau.
5. Régler à fond UNE douleur plutôt que tout à moitié.

> Détails de recherche métier conservés dans la mémoire projet de Claude (synthèse FEFO / food cost /
> autocontrôle Suisse / UX d'adoption).

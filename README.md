# Brigade Stock

Cockpit intelligent de gestion de stock pour restaurateurs suisses. L'application transforme les stocks, lots, recettes, fournisseurs, prévisions de service et autocontrôle en actions concrètes avant le service.

## Problèmes ciblés

- Commandes faites au feeling, sans lien clair avec la demande prévue.
- Ruptures pendant le service, surtout sur les ingrédients critiques.
- Surstock et DLC oubliées dans les frigos.
- Écarts entre stock théorique et stock réel.
- Prix fournisseurs qui changent sans impact immédiat sur les marges recettes.
- Pertes notées trop tard ou jamais notées.

## Ce que fait l'app

- Tableau de bord avec risque financier, food cost prévisionnel, couverture moyenne et actions prioritaires.
- Moteur FEFO/DLC par lot, avec lots à utiliser en premier.
- Prévision de demande à 7 jours selon jour de semaine, tendance recette, événement et niveau de discipline pertes.
- Recommandations de commande par fournisseur, colisage, coût estimé, priorité et raison métier.
- Analyse recettes avec coût portion, marge brute, food cost et risque de rupture 86.
- Réception, inventaire flash et journal des pertes avec persistance locale.
- Module Autocontrôle Suisse : check-list, traçabilité DLC/DDM, étiquettes secondaires, pertes motivées et export de registre.

## Sources métier utilisées

- National Restaurant Association, inventory tech: reporting COGS, waste tracking, usage trends, recipe costing, variance actual/theoretical, purchase orders and alerts.  
  https://restaurant.org/education-and-resources/resource-library/restaurateurs-use-tech-to-manage-inventory%2C-save-money/
- USDA Food Waste FAQs: food waste is a major supply-chain issue; over-ordering and storage problems contribute to losses; prevention is the preferred approach.  
  https://www.usda.gov/about-food/food-safety/food-loss-and-waste/food-waste-faqs
- National Restaurant Association, food waste costs: commercial kitchens commonly waste 4% to 10% of purchased food before it reaches the guest.  
  https://restaurant.org/education-and-resources/resource-library/control-your-food-waste-to-reduce-rising-costs/
- National Restaurant Association, reducing food waste: use sales history, future events, menu plans and recipe quantities to improve forecasting and ordering.  
  https://restaurant.org/education-and-resources/resource-library/working-to-reduce-food-waste/
## Sources Suisse

- LDAI art. 26, autocontrôle: la personne qui fabrique, traite, entrepose, transporte ou met sur le marché des denrées doit veiller au respect des exigences légales; le contrôle officiel ne remplace pas l'autocontrôle.  
  https://www.fedlex.admin.ch/eli/cc/2017/62/fr
- ODAlOUs, obligation d'annonce et cadre denrées alimentaires/objets usuels.  
  https://www.fedlex.admin.ch/eli/cc/2017/63/fr
- OSAV, étiquetage: distinction DDM/DLC et indications de conservation.  
  https://www.blv.admin.ch/blv/fr/home/lebensmittel-und-ernaehrung/lebensmittelsicherheit/naehrwertinformationen-und-kennzeichnung/lebensmitteletikette.html
- OSAV, guides de bonnes pratiques: les branches peuvent établir des guides approuvés par l'OSAV.  
  https://www.blv.admin.ch/blv/fr/home/lebensmittel-und-ernaehrung/rechts-und-vollzugsgrundlagen/hilfsmittel-und-vollzugsgrundlagen/leitlinien-gute-verfahrenspraxis.html

## Lancer

```bash
npm install
npm run dev
```

URL locale par défaut : http://127.0.0.1:5173/

## Vérifications

```bash
npm run build
npm audit
```

Un smoke test Playwright a validé le rendu, la navigation, le filtre stock et un champ de formulaire de réception.

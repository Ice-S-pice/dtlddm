import { expect, test } from "@playwright/test";

const emptyState = {
  ingredients: [],
  batches: [],
  recipes: [],
  controlChecks: [],
  logs: [],
};

const salade = {
  id: "salade",
  name: "salade",
  category: "Fruits & légumes",
  unit: "piece",
  zone: "Frigo",
  supplier: "roduit",
  alternativeSupplier: "",
  packSize: 3,
  packLabel: "3 piece",
  price: 2,
  previousPrice: 2,
  leadTime: 2,
  targetDays: 3,
  safetyDays: 1,
  shelfLife: 33,
  critical: false,
  theoretical: 0,
  lastCounted: "jamais",
  variance: 0,
  parMin: 0,
  parMax: 0,
  wasteRate: 0.04,
};

async function openWithState(page, state) {
  await page.addInitScript((savedState) => {
    localStorage.clear();
    localStorage.setItem("brigade-stock-state-v5", JSON.stringify(savedState));
  }, state);
  await page.goto("/");
}

async function goTo(page, tabName) {
  await page.getByRole("button", { name: tabName }).click();
}

test("conseils stock: affiche les portions possibles par recette", async ({ page }) => {
  await openWithState(page, {
    ...emptyState,
    ingredients: [
      {
        ...salade,
        id: "boeuf",
        name: "filet de boeuf",
        category: "Viandes",
        unit: "kg",
        supplier: "epalinges",
        price: 3.5,
        packSize: 1,
        packLabel: "1 kg",
        wasteRate: 0,
      },
    ],
    batches: [{ id: "lot-boeuf", ingredientId: "boeuf", lot: "B-1", qty: 12, receivedOffset: 0, expiryOffset: 5, dateType: "DLC" }],
    recipes: [
      {
        id: "burger",
        name: "Burger maison",
        station: "Grill",
        price: 18,
        dailyBase: 1,
        popularity: 1,
        trend: 0,
        ingredients: [{ id: "boeuf", qty: 0.2 }],
      },
    ],
  });

  await goTo(page, "Conseils stock");

  await expect(page.getByRole("heading", { name: "Ce que ton stock permet de produire" })).toBeVisible();
  await expect(page.locator(".recipe-advice-panel")).toContainText("Burger maison");
  await expect(page.locator(".recipe-advice-panel")).toContainText("60 portions");
  await expect(page.locator(".recipe-advice-panel")).toContainText("filet de boeuf");
});

test("navigation: l'onglet commandes est retiré du menu et du guide", async ({ page }) => {
  await openWithState(page, emptyState);

  await expect(page.getByRole("button", { name: "Commandes" })).toHaveCount(0);

  await page.getByRole("button", { name: "Guide rapide" }).click();
  const guide = page.getByRole("dialog", { name: "Visite guidée" });

  for (let step = 0; step < 8; step += 1) {
    await expect(guide).not.toContainText(/commande/i);
    if (step < 7) await guide.getByRole("button", { name: "Suivant" }).click();
  }
});

test("réception: un code-barres connu sélectionne le produit livré", async ({ page }) => {
  await openWithState(page, {
    ...emptyState,
    ingredients: [{ ...salade, barcode: "7612345678901" }],
  });

  await goTo(page, "Mouvements");
  await page.getByLabel("Code-barres / QR réception").fill("7612345678901");
  await page.getByRole("button", { name: "Chercher" }).click();

  await expect(page.locator(".scan-status")).toContainText("salade sélectionné");
  await expect(page.getByLabel("Produit livré")).toHaveValue("salade");
});

test("inventaire: un écart de stock affiche une alerte explicite", async ({ page }) => {
  await openWithState(page, {
    ...emptyState,
    ingredients: [salade],
    batches: [{ id: "lot-salade", ingredientId: "salade", lot: "SAL-1", qty: 20, receivedOffset: 0, expiryOffset: 3, dateType: "DLC" }],
  });

  await goTo(page, "Mouvements");
  await page.locator(".stepper input").fill("19");

  await expect(page.locator(".count-warning")).toContainText("Stock réel inférieur");
  await expect(page.locator(".count-warning")).toContainText("Vérifier une perte");
});

test("stock: affiche absence de recette liée et les deux dates DLC/DDM", async ({ page }) => {
  await openWithState(page, {
    ...emptyState,
    ingredients: [salade],
    batches: [
      {
        id: "lot-salade",
        ingredientId: "salade",
        lot: "SAL-1",
        qty: 12,
        receivedOffset: 0,
        expiryOffset: 7,
        dateType: "DLC",
        dlcOffset: 7,
        ddmOffset: 4,
      },
    ],
  });

  await expect(page.locator("tbody")).toContainText("Pas de recette liée");
  await expect(page.locator("tbody")).toContainText("seuil non calculé");
  await expect(page.locator("tbody")).toContainText("DLC");
  await expect(page.locator("tbody")).toContainText("DDM");
});

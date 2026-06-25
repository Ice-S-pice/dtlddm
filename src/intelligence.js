const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const money = new Intl.NumberFormat("fr-CH", {
  style: "currency",
  currency: "CHF",
  maximumFractionDigits: 0,
});

export const preciseMoney = new Intl.NumberFormat("fr-CH", {
  style: "currency",
  currency: "CHF",
  maximumFractionDigits: 2,
});

export const number = new Intl.NumberFormat("fr-CH", {
  maximumFractionDigits: 1,
});

export function todayStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function fromOffset(offset) {
  const date = todayStart();
  date.setDate(date.getDate() + Number(offset || 0));
  return date;
}

export function dateLabel(offset) {
  return fromOffset(offset).toLocaleDateString("fr-CH", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

export function daysBetween(date) {
  const target = new Date(date);
  const start = todayStart();
  return Math.round((target - start) / MS_PER_DAY);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

export function recipeIngredientCost(lines, ingredientMap) {
  return (lines || []).reduce((sum, line) => {
    const ingredient = ingredientMap.get(line.id);
    if (!ingredient) return sum;
    return sum + (ingredient.price || 0) * line.qty * (1 + (ingredient.wasteRate || 0));
  }, 0);
}

function roundToPack(qty, packSize) {
  if (!packSize || packSize <= 0) return round(qty, 1);
  return round(Math.ceil(qty / packSize) * packSize, packSize < 1 ? 2 : 1);
}

function weekdayMultiplier(dayIndex) {
  const table = [0.86, 0.72, 0.82, 0.98, 1.12, 1.38, 1.54];
  return table[dayIndex] || 1;
}

function buildDailyForecast(recipes, scenario) {
  const start = todayStart();
  const totalPopularity = recipes.reduce((sum, recipe) => sum + recipe.popularity, 0);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const isWeekend = date.getDay() === 5 || date.getDay() === 6;
    const eventPortion = index === 3 || index === 4 ? scenario.eventCovers / 2 : 0;
    const dayRecipes = recipes.map((recipe) => {
      const demand =
        recipe.dailyBase *
        weekdayMultiplier(date.getDay()) *
        (scenario.demandIndex / 100) *
        (1 + recipe.trend * 0.45);
      const eventDemand = eventPortion * (recipe.popularity / totalPopularity);
      return {
        recipeId: recipe.id,
        units: Math.max(0, Math.round(demand + eventDemand)),
      };
    });
    const units = dayRecipes.reduce((sum, item) => sum + item.units, 0);
    return {
      date,
      label: date.toLocaleDateString("fr-FR", { weekday: "short" }),
      service: isWeekend ? "fort" : "normal",
      units,
      recipes: dayRecipes,
    };
  });
}

function getLotsForIngredient(batches, ingredientId) {
  return batches
    .filter((batch) => batch.ingredientId === ingredientId && Number(batch.qty) > 0)
    .sort((a, b) => a.expiryOffset - b.expiryOffset);
}

function calculateUsage(ingredients, recipes, dailyForecast, scenario) {
  const usage = new Map();
  const revenueByRecipe = new Map();
  const unitsByRecipe = new Map();
  const ingredientMap = new Map(ingredients.map((item) => [item.id, item]));

  for (const day of dailyForecast) {
    for (const recipeForecast of day.recipes) {
      const recipe = recipes.find((entry) => entry.id === recipeForecast.recipeId);
      if (!recipe) continue;

      unitsByRecipe.set(recipe.id, (unitsByRecipe.get(recipe.id) || 0) + recipeForecast.units);
      revenueByRecipe.set(
        recipe.id,
        (revenueByRecipe.get(recipe.id) || 0) + recipeForecast.units * recipe.price,
      );

      for (const line of recipe.ingredients) {
        const ingredient = ingredientMap.get(line.id);
        const disciplineGain = clamp((scenario.wasteDiscipline - 60) / 1000, -0.04, 0.05);
        const wasteFactor = 1 + (ingredient?.wasteRate || 0.03) - disciplineGain;
        usage.set(line.id, (usage.get(line.id) || 0) + line.qty * recipeForecast.units * wasteFactor);
      }
    }
  }

  return { usage, revenueByRecipe, unitsByRecipe };
}

function stockStateFor(ingredient, batches, weeklyUsage, scenario) {
  const lots = getLotsForIngredient(batches, ingredient.id);
  const usableLots = lots.filter((lot) => lot.expiryOffset >= 0);
  const expiredQty = lots
    .filter((lot) => lot.expiryOffset < 0)
    .reduce((sum, lot) => sum + Number(lot.qty), 0);
  const expiringSoonQty = usableLots
    .filter((lot) => lot.expiryOffset <= 2)
    .reduce((sum, lot) => sum + Number(lot.qty), 0);
  const currentStock = usableLots.reduce((sum, lot) => sum + Number(lot.qty), 0);
  const dailyUsage = weeklyUsage / 7;
  const daysCover = dailyUsage > 0 ? currentStock / dailyUsage : 99;
  const leadDays = ingredient.leadTime + Number(scenario.supplierDelay || 0);
  const safetyDays = ingredient.safetyDays + Number(scenario.safetyBuffer || 0);
  const reorderPoint = dailyUsage * (leadDays + safetyDays);
  const targetStock = dailyUsage * (leadDays + safetyDays + ingredient.targetDays);
  const excessExpiring = Math.max(0, expiringSoonQty - dailyUsage * 2);
  const effectiveStock = Math.max(0, currentStock - excessExpiring);
  const needsRestock = effectiveStock <= reorderPoint || daysCover < leadDays + safetyDays + 0.5;
  const value = currentStock * ingredient.price;
  const expiredValue = expiredQty * ingredient.price;
  const expiringValue = expiringSoonQty * ingredient.price;
  const priceJump = ingredient.previousPrice
    ? (ingredient.price - ingredient.previousPrice) / ingredient.previousPrice
    : 0;
  const varianceValue = Math.abs(ingredient.variance || 0) * ingredient.price;
  const recommendedParMin = roundToPack(reorderPoint, ingredient.packSize);
  const recommendedParMax = roundToPack(targetStock, ingredient.packSize);
  const configuredPar = Number(ingredient.parMax) || 0;
  const parDrift = configuredPar > 0 ? (recommendedParMax - configuredPar) / configuredPar : 0;
  const parStale = configuredPar > 0 && dailyUsage > 0 && Math.abs(parDrift) > 0.15;

  const stockoutRisk = daysCover < leadDays + 1;
  const expiryRisk = expiredQty > 0 || excessExpiring > 0;
  const varianceRisk = varianceValue > Math.max(14, value * 0.08);
  const priceRisk = priceJump > 0.08;
  const overstockRisk = daysCover > ingredient.targetDays * 2.2 && ingredient.shelfLife <= 12;

  const riskScore =
    (stockoutRisk ? 42 : 0) +
    (expiryRisk ? 24 : 0) +
    (varianceRisk ? 14 : 0) +
    (priceRisk ? 10 : 0) +
    (overstockRisk ? 8 : 0) +
    (ingredient.critical ? 6 : 0);

  let status = "Stable";
  if (stockoutRisk || expiredQty > 0) status = "Critique";
  else if (expiryRisk || varianceRisk || priceRisk || needsRestock) status = "À surveiller";
  else if (overstockRisk) status = "Surstock";

  return {
    ...ingredient,
    lots,
    currentStock: round(currentStock, ingredient.unit === "piece" ? 0 : 1),
    expiredQty: round(expiredQty, 1),
    expiringSoonQty: round(expiringSoonQty, 1),
    weeklyUsage: round(weeklyUsage, 1),
    dailyUsage: round(dailyUsage, 2),
    daysCover: round(daysCover, 1),
    leadDays,
    reorderPoint: round(reorderPoint, 1),
    targetStock: round(targetStock, 1),
    recommendedParMin,
    recommendedParMax,
    parDrift,
    parStale,
    effectiveStock: round(effectiveStock, 1),
    value,
    expiredValue,
    expiringValue,
    priceJump,
    varianceValue,
    stockoutRisk,
    expiryRisk,
    varianceRisk,
    priceRisk,
    overstockRisk,
    needsRestock,
    riskScore,
    status,
  };
}

function buildMenuInsights(recipes, enrichedInventory, usageData) {
  const inventoryMap = new Map(enrichedInventory.map((item) => [item.id, item]));

  return recipes
    .map((recipe) => {
      const units = usageData.unitsByRecipe.get(recipe.id) || 0;
      const revenue = usageData.revenueByRecipe.get(recipe.id) || 0;
      const ingredientCost = recipeIngredientCost(recipe.ingredients, inventoryMap);
      const foodCostPct = recipe.price > 0 ? (ingredientCost / recipe.price) * 100 : 0;
      const weeklyCost = ingredientCost * units;
      const limitingIngredient = recipe.ingredients
        .map((line) => {
          const item = inventoryMap.get(line.id);
          const dailyNeed = line.qty * (recipe.dailyBase || 1);
          return {
            item,
            cover: item && dailyNeed > 0 ? item.currentStock / dailyNeed : 99,
          };
        })
        .sort((a, b) => a.cover - b.cover)[0];
      const expiringIngredient = recipe.ingredients
        .map((line) => inventoryMap.get(line.id))
        .filter(Boolean)
        .sort((a, b) => b.expiringValue - a.expiringValue)[0];

      let action = "Maintenir";
      if (limitingIngredient?.cover < 2.5) action = `Stock trop juste: ${limitingIngredient.item.name}`;
      else if (foodCostPct > 34) action = "Revoir prix ou grammage";
      else if (expiringIngredient?.expiringSoonQty > 0) action = `Utiliser vite: ${expiringIngredient.name}`;

      return {
        ...recipe,
        units,
        revenue,
        ingredientCost,
        foodCostPct,
        weeklyCost,
        grossMargin: recipe.price - ingredientCost,
        limitingIngredient,
        action,
      };
    })
    .sort((a, b) => a.foodCostPct - b.foodCostPct);
}

function buildWasteByCategory(enrichedInventory) {
  const categories = enrichedInventory.reduce((map, item) => {
    const value = (map.get(item.category) || 0) + item.expiringValue + item.expiredValue;
    map.set(item.category, value);
    return map;
  }, new Map());

  return Array.from(categories.entries())
    .map(([category, value]) => ({ category, value }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value);
}

function buildRecipeStockAdvice(recipes, enrichedInventory, usageData) {
  const inventoryMap = new Map(enrichedInventory.map((item) => [item.id, item]));

  return recipes
    .map((recipe) => {
      const weeklyForecast = usageData.unitsByRecipe.get(recipe.id) || 0;
      const lines = (recipe.ingredients || [])
        .map((line) => {
          const item = inventoryMap.get(line.id);
          if (!item) return null;
          const wasteFactor = 1 + (item.wasteRate || 0);
          const qtyPerUnit = line.qty * wasteFactor;
          const portionsPossible = qtyPerUnit > 0 ? item.currentStock / qtyPerUnit : 99;
          const weeklyNeed = qtyPerUnit * weeklyForecast;
          const missingQty = round(Math.max(0, weeklyNeed - item.currentStock), item.unit === "piece" ? 0 : 2);

          return {
            id: item.id,
            name: item.name,
            unit: item.unit,
            qtyPerUnit,
            currentStock: item.currentStock,
            portionsPossible,
            weeklyNeed,
            missingQty,
            daysCover: item.daysCover,
            expiryRisk: item.expiryRisk,
            stockoutRisk: item.stockoutRisk,
          };
        })
        .filter(Boolean);

      const limitingIngredient = lines.slice().sort((a, b) => a.portionsPossible - b.portionsPossible)[0] || null;
      const portionsPossible = lines.length
        ? Math.max(0, Math.floor(Math.min(...lines.map((line) => line.portionsPossible))))
        : 0;
      const missingLines = lines.filter((line) => line.missingQty > 0);
      const dailyBase = Number(recipe.dailyBase || 0);
      const serviceCover = dailyBase > 0 ? portionsPossible / dailyBase : 99;
      const expiringLines = lines.filter((line) => line.expiryRisk);

      let severity = "ok";
      let status = "OK";
      if (missingLines.length || limitingIngredient?.stockoutRisk) {
        severity = "danger";
        status = "Stock trop juste";
      } else if (expiringLines.length) {
        severity = "warning";
        status = "À utiliser vite";
      } else if (weeklyForecast > 0 && portionsPossible < weeklyForecast * 1.2) {
        severity = "warning";
        status = "À surveiller";
      }

      return {
        id: recipe.id,
        name: recipe.name,
        station: recipe.station,
        weeklyForecast,
        portionsPossible,
        serviceCover,
        limitingIngredient,
        missingLines,
        expiringLines,
        lines,
        severity,
        status,
      };
    })
    .sort((a, b) => {
      const severityScore = { danger: 0, warning: 1, ok: 2 };
      return (severityScore[a.severity] ?? 9) - (severityScore[b.severity] ?? 9) || a.serviceCover - b.serviceCover;
    });
}

function buildCountAdvice(enrichedInventory) {
  const candidates = enrichedInventory
    .map((item) => {
      const reasons = [];
      let score = item.riskScore || 0;
      let severity = item.status === "Critique" ? "danger" : "warning";

      if (item.stockoutRisk) {
        reasons.push(`Stock trop juste: ${number.format(item.daysCover)} j restants`);
        score += 30;
        severity = "danger";
      }
      if (item.expiryRisk) {
        reasons.push(`${number.format(item.expiringSoonQty + item.expiredQty)} ${item.unit} proche DLC/DDM`);
        score += 22;
        if (severity !== "danger") severity = "warning";
      }
      if (item.varianceRisk) {
        reasons.push(`Écart stock réel: ${preciseMoney.format(item.varianceValue)}`);
        score += 18;
      }
      if (item.critical) {
        reasons.push("Produit critique pour la carte");
        score += 12;
      }
      if (item.priceRisk) {
        reasons.push(`Prix fournisseur +${Math.round(item.priceJump * 100)}%`);
        score += 8;
      }
      if (item.parStale) {
        reasons.push("Stock cible a recalculer");
        score += 6;
      }
      if (item.value >= 80) {
        reasons.push(`Valeur stock: ${money.format(item.value)}`);
        score += Math.min(14, item.value / 20);
      }
      if (item.lastCounted === "jamais") {
        reasons.push("Jamais compté");
        score += 5;
      }

      if (!reasons.length && item.value < 40) return null;

      return {
        id: item.id,
        name: item.name,
        unit: item.unit,
        currentStock: item.currentStock,
        status: item.status,
        severity: severity === "danger" ? "danger" : "warning",
        score,
        reason: reasons[0] || "Stock à confirmer",
        details: reasons.slice(1, 3),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  return candidates.slice(0, 8);
}

function inferDateType(ingredient, batch) {
  if (batch.dateType) return batch.dateType;
  const category = (ingredient.category || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  const zone = (ingredient.zone || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  if (category.includes("epicerie") || zone.includes("reserve")) return "DDM";
  return "DLC";
}

function secondaryDueOffset(batch, dateType) {
  if (typeof batch.secondaryExpiryOffset === "number") return batch.secondaryExpiryOffset;
  if (typeof batch.openedOffset !== "number") return null;
  const baseWindow = dateType === "DDM" ? 7 : 2;
  return Math.min(batch.expiryOffset, batch.openedOffset + baseWindow);
}

function buildSwissAutocontrol(enrichedInventory, batches, controlChecks = []) {
  const inventoryMap = new Map(enrichedInventory.map((item) => [item.id, item]));
  const lotRegister = batches
    .filter((batch) => Number(batch.qty) > 0)
    .map((batch) => {
      const ingredient = inventoryMap.get(batch.ingredientId);
      const dateType = inferDateType(ingredient || {}, batch);
      const secondaryOffset = secondaryDueOffset(batch, dateType);
      const missing = [];
      if (!batch.lot) missing.push("lot");
      if (typeof batch.receivedOffset !== "number") missing.push("réception");
      if (typeof batch.expiryOffset !== "number") missing.push("DLC/DDM");
      if (!ingredient?.supplier) missing.push("fournisseur");
      const opened = typeof batch.openedOffset === "number";
      const needsSecondary = opened && dateType === "DLC" && typeof batch.secondaryExpiryOffset !== "number";
      const secondaryExpired = typeof secondaryOffset === "number" && secondaryOffset < 0;
      const dateExpired = batch.expiryOffset < 0;
      const status = missing.length
        ? "Incomplet"
        : dateExpired || secondaryExpired
          ? "Bloqué"
          : needsSecondary
            ? "Étiquette"
            : batch.expiryOffset <= 2
              ? "À utiliser"
              : "OK";

      return {
        ...batch,
        ingredientName: ingredient?.name || batch.ingredientId,
        supplier: ingredient?.supplier || "Fournisseur inconnu",
        zone: ingredient?.zone || "Zone inconnue",
        unit: ingredient?.unit || "",
        dateType,
        opened,
        secondaryOffset,
        needsSecondary,
        secondaryExpired,
        dateExpired,
        missing,
        status,
      };
    })
    .sort((a, b) => {
      const score = { "Bloqué": 0, Étiquette: 1, "À utiliser": 2, Incomplet: 3, OK: 4 };
      return (score[a.status] ?? 9) - (score[b.status] ?? 9) || a.expiryOffset - b.expiryOffset;
    });

  const overdueChecks = controlChecks.filter((check) => check.status === "todo" || check.status === "attention");
  const blockedLots = lotRegister.filter((lot) => lot.status === "Bloqué");
  const secondaryMissing = lotRegister.filter((lot) => lot.needsSecondary);
  const incompleteLots = lotRegister.filter((lot) => lot.missing.length > 0);
  const traceOk = lotRegister.length
    ? Math.round(((lotRegister.length - incompleteLots.length) / lotRegister.length) * 100)
    : 100;
  const score = clamp(
    100 -
      blockedLots.length * 12 -
      secondaryMissing.length * 5 -
      incompleteLots.length * 8 -
      overdueChecks.length * 4,
    0,
    100,
  );

  const nextAction =
    blockedLots[0]
        ? `Isoler ${blockedLots[0].ingredientName} lot ${blockedLots[0].lot}`
        : secondaryMissing[0]
          ? `Créer l'étiquette secondaire ${secondaryMissing[0].ingredientName}`
          : overdueChecks[0]
            ? `Signer ${overdueChecks[0].label}`
            : "Registre à jour";

  return {
    score: Math.round(score),
    traceOk,
    lotRegister,
    overdueChecks,
    blockedLots,
    secondaryMissing,
    incompleteLots,
    nextAction,
  };
}

function buildAlerts(enrichedInventory, menuInsights, swissAutocontrol) {
  const alerts = [];
  const expired = enrichedInventory.filter((item) => item.expiredQty > 0);
  const stockouts = enrichedInventory.filter((item) => item.stockoutRisk);
  const expiring = enrichedInventory.filter((item) => item.expiringSoonQty > 0);
  const variances = enrichedInventory
    .filter((item) => item.varianceRisk)
    .sort((a, b) => b.varianceValue - a.varianceValue);
  const priceJumps = enrichedInventory.filter((item) => item.priceRisk);
  const parReviews = enrichedInventory
    .filter((item) => item.parStale)
    .sort((a, b) => Math.abs(b.parDrift) - Math.abs(a.parDrift));
  const menuRisks = menuInsights.filter((item) => item.action.startsWith("Stock trop juste"));

  if (swissAutocontrol?.secondaryMissing?.length) {
    alerts.push({
      severity: "warning",
      title: "Étiquettes secondaires",
      body: swissAutocontrol.secondaryMissing
        .slice(0, 3)
        .map((lot) => `${lot.ingredientName} lot ${lot.lot}`)
        .join(" · "),
      action: "Produit ouvert ou préparé: ajoute une date interne",
      tab: "compliance",
      cta: "Étiqueter",
    });
  }

  if (swissAutocontrol?.incompleteLots?.length) {
    alerts.push({
      severity: "warning",
      title: "Traçabilité à compléter",
      body: `${swissAutocontrol.incompleteLots.length} lot${swissAutocontrol.incompleteLots.length > 1 ? "s" : ""} sans information complète`,
      action: "Compléter fournisseur, lot, réception ou DLC/DDM",
      tab: "compliance",
      cta: "Voir registre",
    });
  }

  if (stockouts.length) {
    alerts.push({
      severity: "danger",
      title: `${stockouts.length} produit${stockouts.length > 1 ? "s" : ""} trop juste${stockouts.length > 1 ? "s" : ""}`,
      body: stockouts
        .slice(0, 3)
        .map((item) => `${item.name}: ${item.daysCover} j`)
        .join(" · "),
      action: "Vérifier les recettes touchées et le produit bloquant",
      tab: "advice",
      cta: "Voir les conseils",
    });
  }

  if (expired.length) {
    alerts.push({
      severity: "danger",
      title: "DLC dépassée",
      body: expired.map((item) => `${item.name} (${number.format(item.expiredQty)} ${item.unit})`).join(" · "),
      action: "Isoler et enregistrer la perte",
      tab: "operations",
      cta: "Enregistrer la perte",
    });
  }

  if (expiring.length) {
    alerts.push({
      severity: "warning",
      title: `${money.format(expiring.reduce((sum, item) => sum + item.expiringValue, 0))} à utiliser vite`,
      body: expiring
        .slice(0, 4)
        .map((item) => `${item.name}: ${number.format(item.expiringSoonQty)} ${item.unit}`)
        .join(" · "),
      action: "Utiliser dans une recette compatible ou retirer",
      tab: "advice",
      cta: "Voir les conseils",
    });
  }

  if (variances.length) {
    alerts.push({
      severity: "warning",
      title: "Écart entre stock calculé et stock réel",
      body: variances
        .slice(0, 3)
        .map((item) => `${item.name}: ${preciseMoney.format(item.varianceValue)}`)
        .join(" · "),
      action: "Vérifier pertes, portions ou erreur de saisie",
      tab: "operations",
      cta: "Compter",
    });
  }

  if (priceJumps.length) {
    alerts.push({
      severity: "info",
      title: "Prix fournisseur en hausse",
      body: priceJumps
        .slice(0, 3)
        .map((item) => `${item.name}: +${Math.round(item.priceJump * 100)}%`)
        .join(" · "),
      action: "Comparer avec un autre fournisseur si besoin",
      tab: "stock",
      cta: "Voir les produits",
    });
  }

  if (parReviews.length) {
    alerts.push({
      severity: "info",
      title: `${parReviews.length} stock cible${parReviews.length > 1 ? "s" : ""} à revoir`,
      body: parReviews
        .slice(0, 3)
        .map((item) => `${item.name}: ${number.format(item.parMax)} → ${number.format(item.recommendedParMax)} ${item.unit}`)
        .join(" · "),
      action: "Mettre à jour le stock cible",
      tab: "stock",
      cta: "Ajuster",
    });
  }

  if (menuRisks.length) {
    alerts.push({
      severity: "danger",
      title: "Recettes limitées par le stock",
      body: menuRisks.map((recipe) => recipe.name).join(" · "),
      action: "Vérifier le produit bloquant avant le service",
      tab: "advice",
      cta: "Voir les conseils",
    });
  }

  return alerts;
}

export function buildIntelligence({
  ingredients,
  batches,
  recipes,
  scenario,
  controlChecks = [],
}) {
  const dailyForecast = buildDailyForecast(recipes, scenario);
  const usageData = calculateUsage(ingredients, recipes, dailyForecast, scenario);
  const enrichedInventory = ingredients
    .map((ingredient) =>
      stockStateFor(ingredient, batches, usageData.usage.get(ingredient.id) || 0, scenario),
    )
    .sort((a, b) => b.riskScore - a.riskScore);
  const menuInsights = buildMenuInsights(recipes, enrichedInventory, usageData);
  const recipeStockAdvice = buildRecipeStockAdvice(recipes, enrichedInventory, usageData);
  const countAdvice = buildCountAdvice(enrichedInventory);
  const swissAutocontrol = buildSwissAutocontrol(
    enrichedInventory,
    batches,
    controlChecks,
  );
  const alerts = buildAlerts(enrichedInventory, menuInsights, swissAutocontrol);
  const wasteByCategory = buildWasteByCategory(enrichedInventory);
  const revenue = Array.from(usageData.revenueByRecipe.values()).reduce((sum, value) => sum + value, 0);
  const usageCost = Array.from(usageData.usage.entries()).reduce((sum, [id, qty]) => {
    const ingredient = ingredients.find((item) => item.id === id);
    return sum + qty * (ingredient?.price || 0);
  }, 0);
  const stockValue = enrichedInventory.reduce((sum, item) => sum + item.value, 0);
  const riskValue = enrichedInventory.reduce(
    (sum, item) => sum + item.expiringValue + item.expiredValue + (item.varianceRisk ? item.varianceValue : 0),
    0,
  );
  const criticalCount = enrichedInventory.filter((item) => item.status === "Critique").length;
  const averageCover =
    enrichedInventory.reduce((sum, item) => sum + Math.min(item.daysCover, 30), 0) /
    Math.max(enrichedInventory.length, 1);
  const potentialSavings = riskValue * 0.55;

  return {
    dailyForecast,
    usageData,
    inventory: enrichedInventory,
    menuInsights,
    recipeStockAdvice,
    countAdvice,
    alerts,
    wasteByCategory,
    swissAutocontrol,
    kpis: {
      revenue,
      usageCost,
      foodCostPct: revenue > 0 ? (usageCost / revenue) * 100 : 0,
      stockValue,
      riskValue,
      criticalCount,
      averageCover,
      potentialSavings,
      autocontrolScore: swissAutocontrol.score,
      traceOk: swissAutocontrol.traceOk,
      countToday: countAdvice.length,
    },
  };
}

export function reduceFromOldestLots(batches, ingredientId, qtyToRemove) {
  let remaining = Number(qtyToRemove || 0);
  return batches
    .slice()
    .sort((a, b) => {
      if (a.ingredientId !== ingredientId && b.ingredientId === ingredientId) return 1;
      if (a.ingredientId === ingredientId && b.ingredientId !== ingredientId) return -1;
      return a.expiryOffset - b.expiryOffset;
    })
    .map((batch) => {
      if (batch.ingredientId !== ingredientId || remaining <= 0) return batch;
      const remove = Math.min(Number(batch.qty), remaining);
      remaining -= remove;
      return { ...batch, qty: round(Number(batch.qty) - remove, 2) };
    })
    .filter((batch) => Number(batch.qty) > 0);
}

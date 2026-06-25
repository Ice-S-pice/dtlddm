import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Barcode,
  Boxes,
  BrainCircuit,
  Calendar,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChefHat,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Download,
  FileText,
  Gauge,
  Minus,
  Moon,
  PackageCheck,
  PackageOpen,
  Pause,
  Percent,
  Play,
  Plus,
  ReceiptText,
  ScanBarcode,
  Search,
  ShieldCheck,
  Sparkles,
  SlidersHorizontal,
  Sun,
  Tag,
  Utensils,
  Wallet,
  Warehouse,
  XCircle,
} from "lucide-react";
import {
  defaultScenario,
  recipes as seedRecipes,
  seedBatches,
  seedIngredients,
  seedLogs,
  controlChecks,
} from "./data.js";
import {
  buildIntelligence,
  dateLabel,
  daysBetween,
  money,
  number,
  preciseMoney,
  recipeIngredientCost,
  reduceFromOldestLots,
  round,
} from "./intelligence.js";

const STORAGE_KEY = "brigade-stock-state-v5";

const productCategories = [
  "Fruits & légumes",
  "Crèmerie",
  "Viandes",
  "Poissons",
  "Épicerie sèche",
  "Boissons",
  "Pâtisserie",
  "Divers",
];

const productUnits = ["kg", "piece", "L", "g", "portion"];
const productZones = ["Réserve", "Cuisine", "Frigo", "Congélateur", "Cave", "Bar"];

const recipeStations = ["Cuisine", "Garde-manger", "Pâtisserie", "Bar", "Pizza", "Grill"];

// Saisie d'une recette en unités de cuisine. On stocke toujours la quantité dans
// l'unité de base du produit (kg, L, pièce) mais on laisse l'utilisateur saisir et
// basculer entre les unités d'une même famille (g↔kg, ml↔L).
const UNIT_META = {
  g: { label: "g", family: "weight", canon: 1, step: 10, decimals: 0, placeholder: "250" },
  kg: { label: "kg", family: "weight", canon: 1000, step: 0.1, decimals: 3, placeholder: "0.25" },
  ml: { label: "ml", family: "volume", canon: 1, step: 10, decimals: 0, placeholder: "150" },
  L: { label: "L", family: "volume", canon: 1000, step: 0.1, decimals: 3, placeholder: "0.15" },
  piece: { label: "pièce", family: "count", canon: 1, step: 0.5, decimals: 2, placeholder: "1" },
  portion: { label: "portion", family: "count", canon: 1, step: 0.5, decimals: 2, placeholder: "1" },
};

const FAMILY_UNITS = {
  weight: ["g", "kg"],
  volume: ["ml", "L"],
  count: [],
};

// Unité de saisie par défaut selon l'unité de stockage du produit.
const DEFAULT_ENTRY = { kg: "g", g: "g", L: "ml", piece: "piece", portion: "portion" };

function unitMeta(unit) {
  return UNIT_META[unit] || { label: unit || "u", family: "count", canon: 1, step: 1, decimals: 2, placeholder: "1" };
}

// Unités proposées au choix pour un produit (ex: [g, kg]). Vide si une seule.
function entryUnitsFor(baseUnit) {
  return FAMILY_UNITS[unitMeta(baseUnit).family] || [];
}

// Renvoie une unité de saisie valide pour ce produit (corrige une unité d'une autre famille).
function resolveEntryUnit(chosen, baseUnit) {
  const fallback = DEFAULT_ENTRY[baseUnit] || baseUnit;
  const units = entryUnitsFor(baseUnit);
  if (units.length <= 1) return fallback;
  return units.includes(chosen) ? chosen : fallback;
}

// Facteur unité de saisie -> unité de base. Ex: g vers base kg = 1/1000.
function entryFactor(entryUnit, baseUnit) {
  return unitMeta(entryUnit).canon / unitMeta(baseUnit).canon;
}

function parseFormNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  const normalized = String(value ?? "")
    .trim()
    .replace(/[\s']/g, "")
    .replace(",", ".");
  if (!normalized) return NaN;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function numberOr(value, fallback) {
  const parsed = parseFormNumber(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBaseQty(entry, entryUnit, baseUnit) {
  return round(parseFormNumber(entry) * entryFactor(entryUnit, baseUnit), 4);
}

function fromBaseEntry(qty, entryUnit, baseUnit) {
  return String(round(qty / entryFactor(entryUnit, baseUnit), unitMeta(entryUnit).decimals));
}

// Affichage lisible : passe en kg / L au-dessus de 1000 g / 1000 ml.
function formatPortionQty(qty, baseUnit) {
  const meta = unitMeta(baseUnit);
  const canonical = qty * meta.canon;
  if (meta.family === "weight") {
    return canonical >= 1000
      ? `${number.format(round(canonical / 1000, 3))} kg`
      : `${number.format(round(canonical, 0))} g`;
  }
  if (meta.family === "volume") {
    return canonical >= 1000
      ? `${number.format(round(canonical / 1000, 3))} L`
      : `${number.format(round(canonical, 0))} ml`;
  }
  const entry = unitMeta(DEFAULT_ENTRY[baseUnit] || baseUnit);
  return `${number.format(round(qty, entry.decimals))} ${entry.label}`;
}

const tabs = [
  { id: "stock", label: "Produits & stock", icon: Boxes },
  { id: "recipes", label: "Recettes", icon: ChefHat },
  { id: "operations", label: "Mouvements", icon: ClipboardCheck },
  { id: "advice", label: "Conseils stock", icon: Gauge },
  { id: "dashboard", label: "Pilotage", icon: BrainCircuit },
  { id: "compliance", label: "Registre & traçabilité", icon: FileText },
];

function initialState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return sanitizeRestaurantState(JSON.parse(saved));
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
  return emptyRestaurant();
}

function emptyRestaurant() {
  return {
    ingredients: [],
    batches: [],
    recipes: [],
    controlChecks,
    logs: [],
  };
}

function demoRestaurant() {
  return {
    ingredients: seedIngredients,
    batches: seedBatches,
    recipes: seedRecipes,
    controlChecks,
    logs: seedLogs,
  };
}

function sanitizeRestaurantState(state) {
  const source = state && typeof state === "object" ? state : {};
  const ingredients = Array.isArray(source.ingredients)
    ? source.ingredients.filter((item) => item?.id).map((item) => {
        const unit = item.unit || "kg";
        const packSize = Math.max(0.01, numberOr(item.packSize, 1));
        const price = Math.max(0, numberOr(item.price, 0));
        return {
          ...item,
          unit,
          barcode: String(item.barcode || ""),
          packSize,
          packLabel: item.packLabel || `${number.format(packSize)} ${unit}`,
          price,
          previousPrice: Math.max(0, numberOr(item.previousPrice, price)),
          leadTime: Math.max(0, numberOr(item.leadTime, 1)),
          targetDays: Math.max(1, numberOr(item.targetDays, 4)),
          safetyDays: Math.max(0, numberOr(item.safetyDays, 1)),
          shelfLife: Math.max(1, numberOr(item.shelfLife, 5)),
          theoretical: Math.max(0, numberOr(item.theoretical, 0)),
          variance: numberOr(item.variance, 0),
          parMin: Math.max(0, numberOr(item.parMin, 0)),
          parMax: Math.max(0, numberOr(item.parMax, 0)),
          wasteRate: Math.max(0, numberOr(item.wasteRate, 0.04)),
        };
      })
    : [];
  const batches = Array.isArray(source.batches)
    ? source.batches
        .filter(Boolean)
        .map((batch) => {
          const dlcOffset = Number.isFinite(parseFormNumber(batch.dlcOffset)) ? parseFormNumber(batch.dlcOffset) : null;
          const ddmOffset = Number.isFinite(parseFormNumber(batch.ddmOffset)) ? parseFormNumber(batch.ddmOffset) : null;
          const expiryOffset = numberOr(batch.expiryOffset, dlcOffset ?? ddmOffset ?? 0);
          return {
            ...batch,
            qty: Math.max(0, numberOr(batch.qty, 0)),
            receivedOffset: numberOr(batch.receivedOffset, 0),
            expiryOffset,
            ...(dlcOffset !== null ? { dlcOffset } : {}),
            ...(ddmOffset !== null ? { ddmOffset } : {}),
            ...(Number.isFinite(parseFormNumber(batch.openedOffset))
              ? { openedOffset: parseFormNumber(batch.openedOffset) }
              : {}),
            ...(Number.isFinite(parseFormNumber(batch.secondaryExpiryOffset))
              ? { secondaryExpiryOffset: parseFormNumber(batch.secondaryExpiryOffset) }
              : {}),
          };
        })
        .filter((batch) => batch.id && batch.ingredientId && batch.qty > 0)
    : [];
  const recipes = Array.isArray(source.recipes)
    ? source.recipes.filter((recipe) => recipe?.id).map((recipe) => ({
        ...recipe,
        price: Math.max(0, numberOr(recipe.price, 0)),
        dailyBase: Math.max(1, numberOr(recipe.dailyBase, 20)),
        popularity: Math.max(0, numberOr(recipe.popularity, 1)),
        trend: numberOr(recipe.trend, 0),
        ingredients: Array.isArray(recipe.ingredients)
          ? recipe.ingredients
              .filter(Boolean)
              .map((line) => ({ ...line, qty: Math.max(0, numberOr(line.qty, 0)) }))
              .filter((line) => line.id && line.qty > 0)
          : [],
      }))
        .filter((recipe) => recipe.ingredients.length > 0)
    : [];
  const { manualOrders: _manualOrders, orders: _orders, ...restState } = source;

  return {
    ...emptyRestaurant(),
    ...restState,
    ingredients,
    batches,
    recipes,
    controlChecks: Array.isArray(source.controlChecks) ? source.controlChecks : controlChecks,
    logs: Array.isArray(source.logs) ? source.logs : [],
  };
}

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function inferProductDateType(product) {
  const category = normalizeText(product?.category);
  const zone = normalizeText(product?.zone);
  return category.includes("epicerie") || zone.includes("reserve") ? "DDM" : "DLC";
}

function lotDateEntries(lot) {
  const entries = [];
  if (typeof lot.dlcOffset === "number") entries.push({ type: "DLC", offset: lot.dlcOffset });
  if (typeof lot.ddmOffset === "number") entries.push({ type: "DDM", offset: lot.ddmOffset });
  if (!entries.length && typeof lot.expiryOffset === "number") {
    entries.push({ type: lot.dateType || "Date", offset: lot.expiryOffset });
  }
  return entries;
}

function lotDateTypeLabel(lot) {
  const hasDlc = typeof lot.dlcOffset === "number";
  const hasDdm = typeof lot.ddmOffset === "number";
  if (hasDlc && hasDdm) return "DLC + DDM";
  if (hasDlc) return "DLC";
  if (hasDdm) return "DDM";
  return lot.dateType || "Date";
}

function lotDateText(lot) {
  const entries = lotDateEntries(lot);
  if (!entries.length) return "date non renseignee";
  return entries.map((entry) => `${entry.type} ${dateLabel(entry.offset)}`).join(" / ");
}

function hasPlannedUsage(item) {
  return Number(item.dailyUsage) > 0;
}

function stockCoverLabel(item) {
  return hasPlannedUsage(item) ? `${item.daysCover} j` : "Pas de recette liée";
}

function stockThresholdLabel(item) {
  return hasPlannedUsage(item) ? `seuil ${number.format(item.reorderPoint)} ${item.unit}` : "seuil non calculé";
}

function stockQuantityLabel(qty, unit) {
  return formatPortionQty(qty, unit);
}

function App() {
  const [data, setData] = useState(initialState);
  const scenario = defaultScenario;
  const [activeTab, setActiveTab] = useState("stock");
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [theme, setTheme] = useState(() => localStorage.getItem("brigade-theme") || "light");
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("brigade-theme", theme);
  }, [theme]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Tous");
  const [editingProduct, setEditingProduct] = useState(null);
  const [deletePrompt, setDeletePrompt] = useState(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [forms, setForms] = useState({
    receiveIngredient: "",
    receiveCode: "",
    receiveQty: "",
    receivePrice: "",
    receiveDlc: "",
    receiveDdm: "",
    countIngredient: "",
    countQty: "",
    wasteIngredient: "",
    wasteQty: "",
    productName: "",
    productCategory: productCategories[0],
    productUnit: "kg",
    productZone: productZones[0],
    productSupplier: "",
    productBarcode: "",
    productPrice: "",
    productInitialQty: "",
    productInitialDlc: "",
    productInitialDdm: "",
    productPackSize: "1",
    productLeadTime: "1",
    productTargetDays: "4",
    productSafetyDays: "1",
    recipeName: "",
    recipeStation: "Cuisine",
    recipePrice: "",
    recipeDailyBase: "20",
    recipeIngredient: "",
    recipeQty: "",
    recipeUnit: "g",
    recipeLines: [],
    wasteReason: "DLC / qualité",
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentDate(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!deletePrompt) return undefined;
    function closeOnEscape(event) {
      if (event.key === "Escape") setDeletePrompt(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [deletePrompt]);

  useEffect(() => {
    const firstIngredient = data.ingredients[0]?.id;
    if (!firstIngredient) return;
    const ingredientIds = new Set(data.ingredients.map((item) => item.id));
    setForms((current) => {
      const next = {
        ...current,
        receiveIngredient: ingredientIds.has(current.receiveIngredient) ? current.receiveIngredient : firstIngredient,
        countIngredient: ingredientIds.has(current.countIngredient) ? current.countIngredient : firstIngredient,
        wasteIngredient: ingredientIds.has(current.wasteIngredient) ? current.wasteIngredient : firstIngredient,
        recipeIngredient: ingredientIds.has(current.recipeIngredient) ? current.recipeIngredient : firstIngredient,
      };
      return next.receiveIngredient === current.receiveIngredient &&
        next.countIngredient === current.countIngredient &&
        next.wasteIngredient === current.wasteIngredient &&
        next.recipeIngredient === current.recipeIngredient
        ? current
        : next;
    });
  }, [data.ingredients]);

  const intelligence = useMemo(
    () =>
      buildIntelligence({
        ingredients: data.ingredients,
        batches: data.batches,
        recipes: data.recipes || [],
        scenario,
        controlChecks: data.controlChecks || controlChecks,
      }),
    [data, scenario],
  );

  const stationList = useMemo(() => {
    const seen = new Set();
    const ordered = [];
    [
      ...recipeStations,
      ...(data.stations || []),
      ...(data.recipes || []).map((recipe) => recipe.station).filter(Boolean),
    ].forEach((station) => {
      if (!seen.has(station)) {
        seen.add(station);
        ordered.push(station);
      }
    });
    return ordered;
  }, [data.stations, data.recipes]);

  const filteredInventory = intelligence.inventory.filter((item) => {
    const matchesQuery = `${item.name} ${item.supplier} ${item.zone}`
      .toLowerCase()
      .includes(query.toLowerCase());
    const matchesCategory = category === "Tous" || item.category === category;
    return matchesQuery && matchesCategory;
  });

  const categories = ["Tous", ...new Set(data.ingredients.map((item) => item.category))];

  function updateForm(key, value) {
    setForms((current) => ({ ...current, [key]: value }));
  }

  function addLog(entry) {
    const now = new Date();
    return {
      id: `log-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      user: "Vous",
      time: now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
      ...entry,
    };
  }

  function startTour() {
    if (!data.ingredients || data.ingredients.length === 0) loadDemoData();
    setActiveTab("stock");
    setTourOpen(true);
  }

  function loadDemoData() {
    const firstIngredient = seedIngredients[0]?.id || "";
    setData(demoRestaurant());
    setForms((current) => ({
      ...current,
      receiveIngredient: firstIngredient,
      countIngredient: firstIngredient,
      wasteIngredient: firstIngredient,
      recipeIngredient: firstIngredient,
      receiveCode: "",
      receiveQty: "",
      receiveDlc: "",
      receiveDdm: "",
      countQty: "",
      wasteQty: "",
      productName: "",
      productSupplier: "",
      productBarcode: "",
      productPrice: "",
      productInitialQty: "",
      productInitialDlc: "",
      productInitialDdm: "",
      recipeQty: "",
      recipeLines: [],
    }));
  }

  function resetRestaurant() {
    setData(emptyRestaurant());
    setCategory("Tous");
    setQuery("");
    setForms((current) => ({
      ...current,
      receiveIngredient: "",
      countIngredient: "",
      wasteIngredient: "",
      recipeIngredient: "",
      receiveCode: "",
      receiveQty: "",
      receiveDlc: "",
      receiveDdm: "",
      countQty: "",
      wasteQty: "",
      productName: "",
      productSupplier: "",
      productBarcode: "",
      productPrice: "",
      productInitialQty: "",
      productInitialDlc: "",
      productInitialDdm: "",
      recipeQty: "",
      recipeLines: [],
    }));
  }

  function createProduct(event) {
    event.preventDefault();
    const name = forms.productName.trim();
    if (!name) return;

    const baseId = slugify(name) || `produit-${Date.now()}`;
    const id = data.ingredients.some((item) => item.id === baseId)
      ? `${baseId}-${String(Date.now()).slice(-5)}`
      : baseId;
    const unit = forms.productUnit || "kg";
    const packSize = Math.max(0.01, parseFormNumber(forms.productPackSize) || 1);
    const price = Math.max(0, parseFormNumber(forms.productPrice) || 0);
    const leadTime = Math.max(0, parseFormNumber(forms.productLeadTime) || 1);
    const targetDays = Math.max(1, parseFormNumber(forms.productTargetDays) || 4);
    const safetyDays = Math.max(0, parseFormNumber(forms.productSafetyDays) || 1);
    const supplier = forms.productSupplier.trim() || "Fournisseur à renseigner";
    const initialQty = Math.max(0, parseFormNumber(forms.productInitialQty) || 0);
    const initialDlcOffset = forms.productInitialDlc ? daysBetween(forms.productInitialDlc) : null;
    const initialDdmOffset = forms.productInitialDdm ? daysBetween(forms.productInitialDdm) : null;
    const inferredDateType = inferProductDateType({
      category: forms.productCategory,
      zone: forms.productZone,
    });
    const dateType = initialDlcOffset !== null ? "DLC" : initialDdmOffset !== null ? "DDM" : inferredDateType;
    const selectedExpiryOffset = dateType === "DLC" ? initialDlcOffset : initialDdmOffset;
    const shelfLife = Math.max(1, selectedExpiryOffset ?? 5);
    const initialExpiryOffset = selectedExpiryOffset ?? shelfLife;

    const product = {
      id,
      name,
      category: forms.productCategory || productCategories[0],
      unit,
      zone: forms.productZone || productZones[0],
      supplier,
      barcode: forms.productBarcode.trim(),
      alternativeSupplier: "",
      packSize,
      packLabel: `${number.format(packSize)} ${unit}`,
      price,
      previousPrice: price,
      leadTime,
      targetDays,
      safetyDays,
      shelfLife,
      critical: false,
      theoretical: 0,
      lastCounted: "jamais",
      variance: 0,
      parMin: 0,
      parMax: 0,
      wasteRate: 0.04,
    };
    const initialBatch =
      initialQty > 0
        ? {
            id: `lot-${id}-${Date.now()}`,
            ingredientId: id,
            lot: `${id.slice(0, 3).toUpperCase()}-${String(Date.now()).slice(-5)}`,
            qty: initialQty,
            receivedOffset: 0,
            expiryOffset: initialExpiryOffset,
            dateType,
            ...(initialDlcOffset !== null ? { dlcOffset: initialDlcOffset } : {}),
            ...(initialDdmOffset !== null ? { ddmOffset: initialDdmOffset } : {}),
          }
        : null;

    setData((current) => ({
      ...current,
      ingredients: [...current.ingredients, product],
      batches: initialBatch ? [...(current.batches || []), initialBatch] : current.batches || [],
      logs: [
        ...(initialBatch
          ? [
              addLog({
                type: "Réception",
                item: product.name,
                qty: `${number.format(initialQty)} ${product.unit}`,
                note: `Stock de départ, ${lotDateText(initialBatch)}`,
              }),
            ]
          : []),
        addLog({
          type: "Produit",
          item: product.name,
          qty: product.unit,
          note: `${product.supplier} · ${preciseMoney.format(product.price)}`,
        }),
        ...(current.logs || []),
      ],
    }));
    setForms((current) => ({
      ...current,
      productName: "",
      productSupplier: "",
      productBarcode: "",
      productPrice: "",
      productInitialQty: "",
      productInitialDlc: "",
      productInitialDdm: "",
      receiveIngredient: id,
      countIngredient: id,
      wasteIngredient: id,
      recipeIngredient: id,
    }));
  }

  function startEditProduct(item) {
    setEditingProduct({
      id: item.id,
      name: item.name,
      category: item.category,
      unit: item.unit,
      zone: item.zone,
      supplier: item.supplier,
      barcode: item.barcode || "",
      price: String(item.price ?? ""),
      packSize: String(item.packSize ?? 1),
      shelfLife: String(item.shelfLife ?? 5),
      leadTime: String(item.leadTime ?? 1),
      targetDays: String(item.targetDays ?? 4),
      safetyDays: String(item.safetyDays ?? 1),
      stockQty: String(item.currentStock ?? 0),
    });
  }

  function updateEditingProduct(key, value) {
    setEditingProduct((current) => (current ? { ...current, [key]: value } : current));
  }

  function saveProductEdit(event) {
    event.preventDefault();
    if (!editingProduct) return;
    const currentItem = intelligence.inventory.find((item) => item.id === editingProduct.id);
    const name = editingProduct.name.trim();
    if (!currentItem || !name) return;

    const actual = Math.max(0, parseFormNumber(editingProduct.stockQty) || 0);
    const currentStock = currentItem.currentStock || 0;
    const delta = round(actual - currentStock, 2);

    setData((current) => {
      let batches = current.batches || [];
      if (delta > 0) {
        batches = [
          ...batches,
          {
            id: `adjust-${editingProduct.id}-${Date.now()}`,
            ingredientId: editingProduct.id,
            lot: "AJUST",
            qty: delta,
            receivedOffset: 0,
            expiryOffset: Math.max(parseFormNumber(editingProduct.shelfLife) || 5, 1),
            dateType: inferProductDateType(editingProduct),
          },
        ];
      } else if (delta < 0) {
        batches = reduceFromOldestLots(batches, editingProduct.id, Math.abs(delta));
      }

      return {
        ...current,
        ingredients: current.ingredients.map((item) =>
          item.id === editingProduct.id
            ? {
                ...item,
                name,
                category: editingProduct.category,
                unit: editingProduct.unit,
                zone: editingProduct.zone,
                supplier: editingProduct.supplier.trim() || "Fournisseur à renseigner",
                barcode: editingProduct.barcode.trim(),
                previousPrice: item.price,
                price: Math.max(0, parseFormNumber(editingProduct.price) || 0),
                packSize: Math.max(0.01, parseFormNumber(editingProduct.packSize) || 1),
                packLabel: `${number.format(Math.max(0.01, parseFormNumber(editingProduct.packSize) || 1))} ${editingProduct.unit}`,
                shelfLife: Math.max(1, parseFormNumber(editingProduct.shelfLife) || 5),
                leadTime: Math.max(0, parseFormNumber(editingProduct.leadTime) || 1),
                targetDays: Math.max(1, parseFormNumber(editingProduct.targetDays) || 4),
                safetyDays: Math.max(0, parseFormNumber(editingProduct.safetyDays) || 1),
                variance: delta,
                lastCounted: delta === 0 ? item.lastCounted : "maintenant",
              }
            : item,
        ),
        batches,
        logs: [
          addLog({
            type: "Produit",
            item: name,
            qty: delta === 0 ? "modifie" : `${delta >= 0 ? "+" : ""}${number.format(delta)} ${editingProduct.unit}`,
            note: "Modification produit",
          }),
          ...(current.logs || []),
        ],
      };
    });
    setEditingProduct(null);
  }

  function deleteProduct(id) {
    const item = data.ingredients.find((entry) => entry.id === id);
    if (!item) return;

    setDeletePrompt({
      id,
      name: item.name,
      lotsCount: (data.batches || []).filter((batch) => batch.ingredientId === id).length,
      recipesCount: (data.recipes || []).filter((recipe) => recipe.ingredients.some((line) => line.id === id)).length,
    });
  }

  function confirmDeleteProduct() {
    if (!deletePrompt) return;
    const productId = deletePrompt.id;
    setData((current) => {
      const item = current.ingredients.find((entry) => entry.id === productId);
      if (!item) return current;
      return {
        ...current,
        ingredients: current.ingredients.filter((entry) => entry.id !== productId),
        batches: (current.batches || []).filter((batch) => batch.ingredientId !== productId),
        recipes: (current.recipes || [])
          .map((recipe) => ({
            ...recipe,
            ingredients: recipe.ingredients.filter((line) => line.id !== productId),
          }))
          .filter((recipe) => recipe.ingredients.length > 0),
        logs: [
          addLog({
            type: "Produit",
            item: item.name,
            qty: "supprime",
            note: "Produit retiré du stock",
          }),
          ...(current.logs || []),
        ],
      };
    });
    setEditingProduct((current) => (current?.id === productId ? null : current));
    setDeletePrompt(null);
  }

  function addRecipeLine() {
    const ingredient = data.ingredients.find((item) => item.id === forms.recipeIngredient);
    const entry = parseFormNumber(forms.recipeQty);
    if (!ingredient || !entry || entry <= 0) return;
    const unit = resolveEntryUnit(forms.recipeUnit, ingredient.unit);
    const qty = toBaseQty(entry, unit, ingredient.unit);

    setForms((current) => {
      const lines = [...(current.recipeLines || [])];
      const index = lines.findIndex((line) => line.id === ingredient.id);
      if (index >= 0) {
        const merged = round(lines[index].qty + qty, 4);
        const lineUnit = resolveEntryUnit(lines[index].unit, ingredient.unit);
        lines[index] = { ...lines[index], qty: merged, unit: lineUnit, raw: fromBaseEntry(merged, lineUnit, ingredient.unit) };
      } else {
        lines.push({ id: ingredient.id, qty, raw: String(entry), unit });
      }
      return { ...current, recipeLines: lines, recipeQty: "" };
    });
  }

  function updateRecipeLineQty(index, entryValue) {
    setForms((current) => {
      const lines = [...(current.recipeLines || [])];
      const line = lines[index];
      if (!line) return current;
      const ingredient = data.ingredients.find((item) => item.id === line.id);
      const unit = resolveEntryUnit(line.unit, ingredient?.unit);
      const entry = parseFormNumber(entryValue);
      lines[index] = {
        ...line,
        unit,
        raw: entryValue,
        qty: entry > 0 ? toBaseQty(entry, unit, ingredient?.unit) : 0,
      };
      return { ...current, recipeLines: lines };
    });
  }

  function updateRecipeLineUnit(index, newUnit) {
    setForms((current) => {
      const lines = [...(current.recipeLines || [])];
      const line = lines[index];
      if (!line) return current;
      const ingredient = data.ingredients.find((item) => item.id === line.id);
      const unit = resolveEntryUnit(newUnit, ingredient?.unit);
      lines[index] = {
        ...line,
        unit,
        raw: line.qty > 0 ? fromBaseEntry(line.qty, unit, ingredient?.unit) : line.raw,
      };
      return { ...current, recipeLines: lines };
    });
  }

  function removeRecipeLine(index) {
    setForms((current) => ({
      ...current,
      recipeLines: (current.recipeLines || []).filter((_, lineIndex) => lineIndex !== index),
    }));
  }

  function addStation(name) {
    const clean = (name || "").trim();
    if (!clean) return;
    setData((current) => {
      const known = new Set([
        ...recipeStations,
        ...(current.stations || []),
        ...(current.recipes || []).map((recipe) => recipe.station).filter(Boolean),
      ]);
      if (known.has(clean)) return current;
      return { ...current, stations: [...(current.stations || []), clean] };
    });
    updateForm("recipeStation", clean);
  }

  function createRecipe(event) {
    event.preventDefault();
    const name = forms.recipeName.trim();
    const price = parseFormNumber(forms.recipePrice);
    const pending = data.ingredients.find((item) => item.id === forms.recipeIngredient);
    const pendingEntry = parseFormNumber(forms.recipeQty);
    const pendingUnit = pending ? resolveEntryUnit(forms.recipeUnit, pending.unit) : null;
    const pendingLine =
      pending && pendingEntry > 0 ? [{ id: pending.id, qty: toBaseQty(pendingEntry, pendingUnit, pending.unit) }] : [];
    const merged = [...(forms.recipeLines || []), ...pendingLine].reduce((map, line) => {
      if (!line.qty || line.qty <= 0) return map;
      map.set(line.id, round((map.get(line.id) || 0) + parseFormNumber(line.qty), 4));
      return map;
    }, new Map());
    const ingredients = Array.from(merged.entries()).map(([id, qty]) => ({ id, qty }));
    if (!name || !price || price <= 0 || ingredients.length === 0) return;

    const baseId = slugify(name) || `recette-${Date.now()}`;
    const recipes = data.recipes || [];
    const id = recipes.some((item) => item.id === baseId) ? `${baseId}-${String(Date.now()).slice(-5)}` : baseId;
    const recipe = {
      id,
      name,
      station: forms.recipeStation.trim() || "Cuisine",
      price,
      dailyBase: Math.max(1, parseFormNumber(forms.recipeDailyBase) || 20),
      popularity: 1,
      trend: 0,
      ingredients,
    };

    setData((current) => ({
      ...current,
      recipes: [...(current.recipes || []), recipe],
      logs: [
        addLog({
          type: "Recette",
          item: recipe.name,
          qty: preciseMoney.format(recipe.price),
          note: `${recipe.ingredients.length} ingredients`,
        }),
        ...(current.logs || []),
      ],
    }));
    setForms((current) => ({
      ...current,
      recipeName: "",
      recipePrice: "",
      recipeQty: "",
      recipeLines: [],
    }));
  }

  function receiveDelivery(event) {
    event.preventDefault();
    const ingredient = data.ingredients.find((item) => item.id === forms.receiveIngredient);
    const qty = parseFormNumber(forms.receiveQty);
    if (!ingredient || !qty || qty <= 0) return;
    const dlcOffset = forms.receiveDlc ? daysBetween(forms.receiveDlc) : null;
    const ddmOffset = forms.receiveDdm ? daysBetween(forms.receiveDdm) : null;
    const price = parseFormNumber(forms.receivePrice) || ingredient.price;
    const inferredDateType = inferProductDateType(ingredient);
    const dateType = dlcOffset !== null ? "DLC" : ddmOffset !== null ? "DDM" : inferredDateType;
    const expiryOffset =
      dateType === "DLC"
        ? dlcOffset ?? ingredient.shelfLife
        : ddmOffset ?? ingredient.shelfLife;

    const batch = {
      id: `lot-${ingredient.id}-${Date.now()}`,
      ingredientId: ingredient.id,
      lot: `${ingredient.id.slice(0, 3).toUpperCase()}-${String(Date.now()).slice(-5)}`,
      qty,
      receivedOffset: 0,
      expiryOffset,
      dateType,
      ...(dlcOffset !== null ? { dlcOffset } : {}),
      ...(ddmOffset !== null ? { ddmOffset } : {}),
    };

    setData((current) => ({
      ...current,
      ingredients: current.ingredients.map((item) =>
        item.id === ingredient.id
          ? { ...item, previousPrice: item.price, price, variance: 0, lastCounted: "maintenant" }
          : item,
      ),
      batches: [...current.batches, batch],
      logs: [
        addLog({
          type: "Réception",
          item: ingredient.name,
          qty: `${number.format(qty)} ${ingredient.unit}`,
          note: `Lot ${batch.lot}, ${lotDateText(batch)}`,
        }),
        ...(current.logs || []),
      ],
    }));
    setForms((current) => ({ ...current, receiveCode: "", receiveQty: "", receivePrice: "", receiveDlc: "", receiveDdm: "" }));
  }

  function countStock(event) {
    event.preventDefault();
    const ingredient = data.ingredients.find((item) => item.id === forms.countIngredient);
    const actual = parseFormNumber(forms.countQty);
    if (!ingredient || Number.isNaN(actual) || actual < 0) return;
    const inventoryItem = intelligence.inventory.find((item) => item.id === ingredient.id);
    const delta = round(actual - (inventoryItem?.currentStock || 0), 2);

    setData((current) => {
      let batches = current.batches;
      if (delta > 0) {
        batches = [
          ...batches,
          {
            id: `adjust-${ingredient.id}-${Date.now()}`,
            ingredientId: ingredient.id,
            lot: "AJUST",
            qty: delta,
            receivedOffset: 0,
            expiryOffset: Math.max(ingredient.shelfLife - 1, 1),
            dateType: inferProductDateType(ingredient),
          },
        ];
      } else if (delta < 0) {
        batches = reduceFromOldestLots(batches, ingredient.id, Math.abs(delta));
      }

      return {
        ...current,
        ingredients: current.ingredients.map((item) =>
          item.id === ingredient.id ? { ...item, variance: delta, lastCounted: "maintenant" } : item,
        ),
        batches,
        logs: [
          addLog({
            type: "Inventaire",
            item: ingredient.name,
            qty: `${delta >= 0 ? "+" : ""}${number.format(delta)} ${ingredient.unit}`,
            note: `Comptage réel: ${number.format(actual)} ${ingredient.unit}`,
          }),
          ...(current.logs || []),
        ],
      };
    });
    setForms((current) => ({ ...current, countQty: "" }));
  }

  function logWaste(event) {
    event.preventDefault();
    const ingredient = data.ingredients.find((item) => item.id === forms.wasteIngredient);
    const qty = parseFormNumber(forms.wasteQty);
    if (!ingredient || !qty || qty <= 0) return;

    setData((current) => ({
      ...current,
      batches: reduceFromOldestLots(current.batches, ingredient.id, qty),
      ingredients: current.ingredients.map((item) =>
        item.id === ingredient.id ? { ...item, variance: round((item.variance || 0) - qty, 2) } : item,
      ),
      logs: [
        addLog({
          type: "Perte",
          item: ingredient.name,
          qty: `${number.format(qty)} ${ingredient.unit}`,
          note: forms.wasteReason,
        }),
        ...(current.logs || []),
      ],
    }));
    setForms((current) => ({ ...current, wasteQty: "" }));
  }

  function signControl(checkId) {
    const check = (data.controlChecks || controlChecks).find((entry) => entry.id === checkId);
    if (!check) return;
    setData((current) => ({
      ...current,
      controlChecks: (current.controlChecks || controlChecks).map((entry) =>
        entry.id === checkId
          ? {
              ...entry,
              status: "done",
              owner: "Vous",
              evidence: `Signé à ${new Date().toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" })}`,
            }
          : entry,
      ),
      logs: [
        addLog({
          type: "Registre",
          item: check.label,
          qty: "OK",
          note: `${check.area} · ${check.cadence}`,
        }),
        ...(current.logs || []),
      ],
    }));
  }

  function createSecondaryLabel(batchId) {
    const batch = data.batches.find((entry) => entry.id === batchId);
    if (!batch) return;
    const ingredient = data.ingredients.find((entry) => entry.id === batch.ingredientId);
    const secondaryExpiryOffset = Math.min(batch.expiryOffset, 2);

    setData((current) => ({
      ...current,
      batches: current.batches.map((entry) =>
        entry.id === batchId
          ? {
              ...entry,
              openedOffset: typeof entry.openedOffset === "number" ? entry.openedOffset : 0,
              secondaryExpiryOffset,
            }
          : entry,
      ),
      logs: [
        addLog({
          type: "Étiquette",
          item: ingredient?.name || batch.ingredientId,
          qty: batch.lot,
          note: `DLC interne ${dateLabel(secondaryExpiryOffset)}`,
        }),
        ...(current.logs || []),
      ],
    }));
  }

  function applyRecommendedPar(id) {
    const item = intelligence.inventory.find((entry) => entry.id === id);
    if (!item) return;
    setData((current) => ({
      ...current,
      ingredients: current.ingredients.map((ing) =>
        ing.id === id
          ? { ...ing, parMin: item.recommendedParMin, parMax: item.recommendedParMax }
          : ing,
      ),
      logs: [
        addLog({
          type: "Par-level",
          item: item.name,
          qty: `${number.format(item.parMax)} → ${number.format(item.recommendedParMax)} ${item.unit}`,
          note: "Aligné sur les ventes réelles",
        }),
        ...(current.logs || []),
      ],
    }));
  }

  function exportAutocontrol() {
    const swiss = intelligence.swissAutocontrol;
    const lines = [
      "Section;Element;Statut;Detail",
      ...swiss.lotRegister.map((lot) =>
        [
          "Traçabilité",
          `${lot.ingredientName} ${lot.lot}`,
          lot.status,
          `${lotDateTypeLabel(lot)}; réception ${dateLabel(lot.receivedOffset)}; ${lotDateText(lot)}; ${lot.supplier}`,
        ].join(";"),
      ),
    ].join("\n");
    const blob = new Blob([lines], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "registre-autocontrole-suisse.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Utensils size={22} />
          </div>
          <div>
            <strong>Brigade Stock</strong>
            <span>Gestion de stock restaurant</span>
          </div>
        </div>

        <nav className="tabs" aria-label="Navigation principale" data-tour="nav">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={activeTab === tab.id ? "active" : ""}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                title={tab.label}
              >
                <Icon size={18} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            title={theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre"}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            <span>{theme === "dark" ? "Mode clair" : "Mode sombre"}</span>
          </button>
          <div className="mini-stat">
            <span>Risque</span>
            <strong>{money.format(intelligence.kpis.riskValue)}</strong>
          </div>
          <div className="mini-stat">
            <span>Food cost</span>
            <strong>{number.format(intelligence.kpis.foodCostPct)}%</strong>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">{currentDate.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long" })}</p>
            <h1>{pageTitle(activeTab)}</h1>
          </div>
          <div className="topbar-actions">
            {activeTab === "compliance" && (
              <button className="primary-button" type="button" onClick={exportAutocontrol}>
                <FileText size={17} />
                <span>Export registre</span>
              </button>
            )}
          </div>
        </header>

        {activeTab === "dashboard" && (
          <Dashboard
            intelligence={intelligence}
            setActiveTab={setActiveTab}
            loadDemoData={loadDemoData}
          />
        )}
        {activeTab === "advice" && (
          <StockAdvice
            intelligence={intelligence}
            setActiveTab={setActiveTab}
            updateForm={updateForm}
          />
        )}
        {activeTab === "stock" && (
          <Stock
            inventory={filteredInventory}
            totalProducts={data.ingredients.length}
            categories={categories}
            category={category}
            setCategory={setCategory}
            query={query}
            setQuery={setQuery}
            forms={forms}
            updateForm={updateForm}
            createProduct={createProduct}
            loadDemoData={loadDemoData}
            startTour={startTour}
            resetRestaurant={resetRestaurant}
            applyRecommendedPar={applyRecommendedPar}
            editingProduct={editingProduct}
            startEditProduct={startEditProduct}
            updateEditingProduct={updateEditingProduct}
            saveProductEdit={saveProductEdit}
            cancelProductEdit={() => setEditingProduct(null)}
            deleteProduct={deleteProduct}
          />
        )}
        {activeTab === "recipes" && (
          <Recipes
            menuInsights={intelligence.menuInsights}
            inventory={intelligence.inventory}
            ingredients={data.ingredients}
            stations={stationList}
            addStation={addStation}
            forms={forms}
            updateForm={updateForm}
            addRecipeLine={addRecipeLine}
            updateRecipeLineQty={updateRecipeLineQty}
            updateRecipeLineUnit={updateRecipeLineUnit}
            removeRecipeLine={removeRecipeLine}
            createRecipe={createRecipe}
          />
        )}
        {activeTab === "compliance" && (
          <TraceabilityRegister
            intelligence={intelligence}
            createSecondaryLabel={createSecondaryLabel}
            exportAutocontrol={exportAutocontrol}
          />
        )}
        {activeTab === "operations" && (
          <Operations
            ingredients={data.ingredients}
            inventory={intelligence.inventory}
            logs={data.logs || []}
            forms={forms}
            updateForm={updateForm}
            receiveDelivery={receiveDelivery}
            countStock={countStock}
            logWaste={logWaste}
            countAdvice={intelligence.countAdvice}
            setActiveTab={setActiveTab}
            loadDemoData={loadDemoData}
          />
        )}
      </main>
      {deletePrompt && (
        <ConfirmDeleteModal
          item={deletePrompt}
          onCancel={() => setDeletePrompt(null)}
          onConfirm={confirmDeleteProduct}
        />
      )}
      {tourOpen && (
        <TourGuide steps={tourSteps} setActiveTab={setActiveTab} onClose={() => setTourOpen(false)} />
      )}
    </div>
  );
}

const tourSteps = [
  {
    title: "Bienvenue",
    body: "Cette app sert à suivre les produits, les recettes, les mouvements de stock et les contrôles. On va voir chaque partie simplement.",
    duration: 5200,
  },
  {
    tab: "stock",
    target: '[data-tour="nav"]',
    title: "Le menu",
    body: "Chaque onglet correspond à une action du restaurant: créer les produits, recevoir une livraison, compter, suivre les recettes ou garder les traces utiles.",
  },
  {
    tab: "stock",
    target: ".setup-form",
    title: "1. Produits & stock",
    body: "Ici tu crées les produits que le restaurant utilise. Tu renseignes l'unité, le prix, le fournisseur, le stock de départ et les dates DLC/DDM si tu les connais.",
  },
  {
    tab: "recipes",
    target: ".recipe-builder",
    title: "2. Recettes",
    body: "Une recette relie un plat aux quantités utilisées. Exemple: 200 g de viande par burger. L'app peut ensuite calculer le coût et ce que ton stock permet de produire.",
  },
  {
    tab: "operations",
    target: ".operations-layout",
    title: "3. Mouvements",
    body: "C'est l'écran du quotidien. Tu l'utilises quand une livraison arrive, quand tu comptes le stock réel ou quand tu retires une perte.",
  },
  {
    tab: "advice",
    target: ".advice-layout",
    title: "4. Conseils stock",
    body: "Ici tu vois les points à surveiller. L'app compare le stock, les recettes et les dates pour montrer les produits à compter, à utiliser vite ou qui risquent de bloquer une recette.",
  },
  {
    tab: "dashboard",
    target: ".dashboard-grid",
    title: "5. Pilotage",
    body: "Cette page résume la situation du jour: valeur du stock, produits à risque, food cost estimé et actions importantes.",
  },
  {
    tab: "compliance",
    target: ".compliance-layout",
    title: "6. Registre & traçabilité",
    body: "Cette partie garde les traces utiles: lots, fournisseurs, DLC/DDM, pertes et actions correctives. Elle sert surtout pour l'autocontrôle.",
  },
  {
    tab: "stock",
    title: "Pour commencer",
    body: "Tu peux charger la démo pour tester, ou créer directement ton premier produit. Ensuite ajoute les recettes pour rendre les conseils vraiment utiles.",
    duration: 6000,
  },
];

function TourGuide({ steps, setActiveTab, onClose }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [rect, setRect] = useState(null);
  const step = steps[index];
  const isLast = index === steps.length - 1;

  useEffect(() => {
    if (step.tab) setActiveTab(step.tab);
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    function measure() {
      if (cancelled) return;
      if (!step.target) {
        setRect(null);
        return;
      }
      const el = document.querySelector(step.target);
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    }
    const el0 = step.target ? document.querySelector(step.target) : null;
    if (el0) el0.scrollIntoView({ block: "center", behavior: "smooth" });
    const t1 = setTimeout(measure, 200);
    const t2 = setTimeout(measure, 520);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelled = true;
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!playing || isLast) return undefined;
    const t = setTimeout(() => setIndex((i) => Math.min(i + 1, steps.length - 1)), step.duration || 7000);
    return () => clearTimeout(t);
  }, [index, playing, isLast]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") setIndex((i) => Math.min(i + 1, steps.length - 1));
      if (event.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function next() {
    if (isLast) onClose();
    else setIndex((i) => i + 1);
  }

  const pad = 8;
  let spotStyle = null;
  let cardStyle;
  if (rect) {
    spotStyle = {
      top: rect.top - pad,
      left: rect.left - pad,
      width: rect.width + pad * 2,
      height: rect.height + pad * 2,
    };
    const cardW = 380;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.min(Math.max(rect.left + rect.width / 2 - cardW / 2, 16), Math.max(16, vw - cardW - 16));
    const spaceBelow = vh - (rect.top + rect.height);
    if (spaceBelow > 250) cardStyle = { top: rect.top + rect.height + 16, left };
    else if (rect.top > 250) cardStyle = { bottom: vh - rect.top + 16, left };
    else cardStyle = { left, bottom: 24 };
  }

  const progress = ((index + 1) / steps.length) * 100;

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="Visite guidée">
      <div className="tour-catcher" onClick={() => setPlaying(false)} />
      {rect ? (
        <div className="tour-spotlight" style={spotStyle} />
      ) : (
        <div className="tour-dim" />
      )}
      <div className={`tour-card ${rect ? "" : "center"}`} style={cardStyle}>
        <div className="tour-progress">
          <i style={{ width: `${progress}%` }} />
        </div>
        <button className="tour-close" type="button" onClick={onClose} aria-label="Fermer le guide">
          <XCircle size={18} />
        </button>
        <p className="tour-step">Étape {index + 1} / {steps.length}</p>
        <h3>{step.title}</h3>
        <p className="tour-body">{step.body}</p>
        <div className="tour-actions">
          <button className="ghost-button compact" type="button" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>
            <ChevronLeft size={16} />
            <span>Précédent</span>
          </button>
          <button className="ghost-button compact" type="button" onClick={() => setPlaying((p) => !p)}>
            {playing ? <Pause size={16} /> : <Play size={16} />}
            <span>{playing ? "Pause" : "Lecture"}</span>
          </button>
          <button className="primary-button compact tour-next" type="button" onClick={next}>
            <span>{isLast ? "Terminer" : "Suivant"}</span>
            {!isLast && <ChevronRight size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDeleteModal({ item, onCancel, onConfirm }) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section className="delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-product-title">
        <button className="modal-close" type="button" onClick={onCancel} aria-label="Fermer">
          <XCircle size={18} />
        </button>
        <div className="modal-icon danger">
          <AlertTriangle size={22} />
        </div>
        <p className="eyebrow">Suppression produit</p>
        <h2 id="delete-product-title">Supprimer {item.name} ?</h2>
        <p className="modal-copy">Les éléments liés à ce produit seront retirés pour garder le stock cohérent.</p>
        <div className="delete-impact" aria-label="Éléments impactés">
          <span>
            <strong>{item.lotsCount}</strong>
            lots
          </span>
          <span>
            <strong>{item.recipesCount}</strong>
            recettes
          </span>
        </div>
        <div className="modal-actions">
          <button className="ghost-button" type="button" onClick={onCancel}>
            Annuler
          </button>
          <button className="danger-button" type="button" onClick={onConfirm}>
            Supprimer
          </button>
        </div>
      </section>
    </div>
  );
}

function pageTitle(tab) {
  return {
    dashboard: "Pilotage",
    advice: "Conseils stock",
    stock: "Produits & stock",
    recipes: "Recettes",
    compliance: "Registre & traçabilité",
    operations: "Mouvements de stock",
  }[tab];
}

function SetupHero({ setActiveTab, loadDemoData }) {
  return (
    <div className="setup-hero">
      <div>
        <p className="eyebrow">Démarrage</p>
        <h2>Commence par créer tes produits</h2>
        <p>Le stock devient utile quand les produits, les lots et les recettes sont renseignés. Tu peux aussi charger la démo pour tester.</p>
      </div>
      <div className="setup-actions">
        <button className="primary-button" type="button" onClick={() => setActiveTab("stock")}>
          <Plus size={17} />
          <span>Créer un produit</span>
        </button>
        <button className="ghost-button" type="button" onClick={loadDemoData}>
          <PackageOpen size={17} />
          <span>Charger une démo</span>
        </button>
      </div>
    </div>
  );
}

function StockAdvice({ intelligence, setActiveTab, updateForm }) {
  const recipes = intelligence.recipeStockAdvice || [];
  const countAdvice = intelligence.countAdvice || [];
  const riskyRecipes = recipes.filter((recipe) => recipe.severity === "danger").length;
  const watchRecipes = recipes.filter((recipe) => recipe.severity === "warning").length;
  const expiringValue = intelligence.inventory.reduce((sum, item) => sum + item.expiringValue + item.expiredValue, 0);

  function openCount(item) {
    updateForm("countIngredient", item.id);
    updateForm("countQty", "");
    setActiveTab("operations");
  }

  if (!intelligence.inventory.length) {
    return (
      <section className="content-stack">
        <div className="panel empty-panel movement-empty">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Conseils stock</p>
              <h2>Pas encore de stock à analyser</h2>
              <p>Ajoute d'abord quelques produits. Les conseils apparaîtront quand l'app pourra comparer stock, dates et recettes.</p>
            </div>
            <Gauge size={22} />
          </div>
          <div className="setup-actions">
            <button className="primary-button" type="button" onClick={() => setActiveTab("stock")}>
              <Plus size={17} />
              <span>Créer un produit</span>
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="advice-layout">
      <div className="panel advice-summary">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Aujourd'hui</p>
            <h2>Conseils stock</h2>
          </div>
          <Gauge size={22} />
        </div>
        <div className="advice-metrics">
          <div>
            <span>Recettes limitées</span>
            <strong>{riskyRecipes}</strong>
          </div>
          <div>
            <span>À utiliser vite</span>
            <strong>{watchRecipes}</strong>
          </div>
          <div>
            <span>Produits à compter</span>
            <strong>{countAdvice.length}</strong>
          </div>
          <div>
            <span>Valeur à surveiller</span>
            <strong>{money.format(expiringValue)}</strong>
          </div>
        </div>
      </div>

      <div className="panel recipe-advice-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Recettes</p>
            <h2>Ce que ton stock permet de produire</h2>
          </div>
          <ChefHat size={22} />
        </div>
        {recipes.length === 0 ? (
          <EmptyState icon={ChefHat} title="Aucune recette" body="Ajoute une recette pour savoir combien de plats ton stock permet de préparer." />
        ) : (
          <div className="recipe-advice-list">
            {recipes.map((recipe) => (
              <article className={`recipe-advice-row ${recipe.severity}`} key={recipe.id}>
                <div className="recipe-advice-main">
                  <div>
                    <strong>{recipe.name}</strong>
                    <span>{recipe.station || "Cuisine"}</span>
                  </div>
                  <span className={`advice-badge ${recipe.severity}`}>{recipe.status}</span>
                </div>
                <div className="recipe-capacity">
                  <div>
                    <span>Tu peux faire</span>
                    <strong>{number.format(recipe.portionsPossible)} portions</strong>
                  </div>
                  <div>
                    <span>Bloqué par</span>
                    <strong>{recipe.limitingIngredient?.name || "Aucune"}</strong>
                  </div>
                </div>
                {recipe.missingLines.length > 0 && (
                  <div className="recipe-missing">
                    <AlertTriangle size={16} />
                    <span>
                      Manque{" "}
                      {recipe.missingLines
                        .slice(0, 3)
                        .map((line) => `${stockQuantityLabel(line.missingQty, line.unit)} ${line.name}`)
                        .join(", ")}
                    </span>
                  </div>
                )}
                {recipe.expiringLines.length > 0 && recipe.missingLines.length === 0 && (
                  <div className="recipe-missing soft">
                    <Clock size={16} />
                    <span>
                      À pousser:{" "}
                      {recipe.expiringLines
                        .slice(0, 3)
                        .map((line) => line.name)
                        .join(", ")}
                    </span>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>

      <aside className="panel count-advice-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Inventaire</p>
            <h2>À compter aujourd'hui</h2>
          </div>
          <ClipboardList size={22} />
        </div>
        {countAdvice.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Rien de prioritaire" body="Aucun produit ne ressort comme urgent à compter aujourd'hui." />
        ) : (
          <div className="count-advice-list">
            {countAdvice.map((item) => (
              <button type="button" className={`count-advice-row ${item.severity}`} key={item.id} onClick={() => openCount(item)}>
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.reason}</small>
                </span>
                <em>
                  {number.format(item.currentStock)} {item.unit}
                </em>
              </button>
            ))}
          </div>
        )}
      </aside>

      <aside className="panel reception-advice-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Réception</p>
            <h2>Réception rapide</h2>
          </div>
          <Barcode size={22} />
        </div>
        <div className="reception-actions">
          <button className="primary-button" type="button" onClick={() => setActiveTab("operations")}>
            <ScanBarcode size={17} />
            <span>Réceptionner</span>
          </button>
          <button className="ghost-button" type="button" onClick={() => setActiveTab("stock")}>
            <Tag size={17} />
            <span>Voir les produits</span>
          </button>
        </div>
      </aside>
    </section>
  );
}

function Dashboard({ intelligence, setActiveTab, loadDemoData }) {
  const topRisk = intelligence.inventory[0];

  if (!intelligence.inventory.length) {
    return (
      <section className="dashboard-grid">
        <SetupHero setActiveTab={setActiveTab} loadDemoData={loadDemoData} />
      </section>
    );
  }

  return (
    <section className="dashboard-grid">
      <div className="kpi-row">
        <Kpi icon={Wallet} label="Valeur stock" value={money.format(intelligence.kpis.stockValue)} tone="blue" />
        <Kpi icon={AlertTriangle} label="À surveiller" value={money.format(intelligence.kpis.riskValue)} tone="red" />
        <Kpi icon={Gauge} label="Jours de stock moy." value={`${number.format(intelligence.kpis.averageCover)} j`} tone="green" />
        <Kpi icon={Percent} label="Food cost estimé" value={`${number.format(intelligence.kpis.foodCostPct)}%`} tone="amber" />
        <Kpi icon={FileText} label="Registre" value={`${intelligence.kpis.autocontrolScore}/100`} tone="teal" />
      </div>

      <div className="panel priority-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Priorités</p>
            <h2>Actions avant service</h2>
          </div>
          <button className="ghost-button compact" type="button" onClick={() => setActiveTab("advice")}>
            <Gauge size={16} />
            <span>Conseils</span>
          </button>
        </div>
        <div className="alert-list">
          {intelligence.alerts.length === 0 ? (
            <div className="alert-empty">
              <CheckCircle2 size={22} />
              <div>
                <strong>Tout est sous contrôle</strong>
                <span>Aucune action requise avant le service.</span>
              </div>
            </div>
          ) : (
            intelligence.alerts.slice(0, 5).map((alert) => (
              <button
                type="button"
                className={`alert-card ${alert.severity}`}
                key={alert.title}
                onClick={() => alert.tab && setActiveTab(alert.tab)}
                disabled={!alert.tab}
              >
                <div className="alert-icon">
                  {alert.severity === "danger" ? <AlertTriangle size={18} /> : <Activity size={18} />}
                </div>
                <div className="alert-body">
                  <strong>{alert.title}</strong>
                  <span>{alert.body}</span>
                </div>
                {alert.cta && (
                  <span className="alert-cta">
                    {alert.cta}
                    <ChevronRight size={15} />
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      <div className="panel intelligence-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">À vérifier</p>
            <h2>Action prioritaire</h2>
          </div>
          <BrainCircuit size={22} />
        </div>
        <div className="decision-box">
          <strong>{topRisk?.name}</strong>
          <p>
            {topRisk?.stockoutRisk
              ? `${stockCoverLabel(topRisk)} seulement. Vérifie ce produit dans Conseils stock avant le service.`
              : topRisk?.expiryRisk
                ? `${number.format(topRisk.expiringSoonQty + topRisk.expiredQty)} ${topRisk.unit} proche DLC/DDM. À utiliser vite ou à retirer si besoin.`
                : "Aucune urgence détectée. Continue à enregistrer les livraisons, pertes et comptages."}
          </p>
        </div>
      </div>

      <div className="panel waste-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Pertes</p>
            <h2>À surveiller</h2>
          </div>
          <PackageOpen size={22} />
        </div>
        <div className="waste-list">
          {intelligence.wasteByCategory.map((entry) => (
            <div className="waste-row" key={entry.category}>
              <span>{entry.category}</span>
              <div className="waste-track">
                <i style={{ width: `${Math.min(100, (entry.value / intelligence.kpis.riskValue) * 100)}%` }} />
              </div>
              <strong>{money.format(entry.value)}</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Kpi({ icon: Icon, label, value, tone }) {
  return (
    <article className={`kpi-card ${tone}`}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <Icon size={22} />
    </article>
  );
}

function Stock({
  inventory,
  totalProducts,
  categories,
  category,
  setCategory,
  query,
  setQuery,
  forms,
  updateForm,
  createProduct,
  loadDemoData,
  startTour,
  resetRestaurant,
  applyRecommendedPar,
  editingProduct,
  startEditProduct,
  updateEditingProduct,
  saveProductEdit,
  cancelProductEdit,
  deleteProduct,
}) {
  return (
    <section className={`content-stack ${inventory.length === 0 ? "stock-empty" : ""}`} data-tour="stock">
      <div className="section-toolbar">
        <div>
          <p className="eyebrow">Base restaurant</p>
          <h2>Produits</h2>
        </div>
        <div className="topbar-actions">
          <button className="ghost-button strong" type="button" onClick={startTour}>
            <Sparkles size={17} />
            <span>Guide rapide</span>
          </button>
          <button className="ghost-button" type="button" onClick={loadDemoData}>
            <PackageOpen size={17} />
            <span>Démo</span>
          </button>
          {totalProducts > 0 && (
            <button className="ghost-button" type="button" onClick={resetRestaurant}>
              <XCircle size={17} />
              <span>Vider</span>
            </button>
          )}
        </div>
      </div>

      <ProductSetupForm forms={forms} updateForm={updateForm} createProduct={createProduct} />

      {inventory.length === 0 && (
        <EmptyState
          icon={Boxes}
          title={totalProducts ? "Aucun produit trouvé" : "Aucun produit"}
          body={totalProducts ? "Change la recherche ou la catégorie." : "Crée le premier produit du restaurant."}
        />
      )}

      <div className="filterbar">
        <div className="searchbox">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Produit, zone, fournisseur" />
        </div>
        <div className="segments">
          {categories.map((entry) => (
            <button
              type="button"
              key={entry}
              className={category === entry ? "active" : ""}
              onClick={() => setCategory(entry)}
            >
              {entry}
            </button>
          ))}
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Produit</th>
              <th>Stock</th>
              <th>Jours restants</th>
              <th>DLC / DDM</th>
              <th>Écart stock réel</th>
              <th>Statut</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {inventory.map((item) => (
              <Fragment key={item.id}>
              <tr>
                <td data-label="Produit">
                  <div className="product-cell">
                    <strong>{item.name}</strong>
                    <span>
                      {item.zone} · {item.supplier}
                    </span>
                  </div>
                </td>
                <td data-label="Stock">
                  {number.format(item.currentStock)} {item.unit}
                </td>
                <td data-label="Jours restants">
                  <div className="cover-cell">
                    <strong>{stockCoverLabel(item)}</strong>
                    <span>{stockThresholdLabel(item)}</span>
                    {item.parStale && applyRecommendedPar && (
                      <button
                        type="button"
                        className="par-tune"
                        onClick={() => applyRecommendedPar(item.id)}
                        title="Ajuster le stock cible selon les ventes réelles"
                      >
                        <SlidersHorizontal size={12} />
                        cible {number.format(item.parMax)} → {number.format(item.recommendedParMax)} {item.unit}
                      </button>
                    )}
                  </div>
                </td>
                <td data-label="DLC / DDM">
                  <div className="lot-stack">
                    {item.lots.slice(0, 3).map((lot) => (
                      <Fragment key={lot.id}>
                        <LotDatePills lot={lot} unit={item.unit} showQty />
                      </Fragment>
                    ))}
                  </div>
                </td>
                <td data-label="Écart stock réel" className={item.variance < 0 ? "negative" : "positive"}>
                  {item.variance >= 0 ? "+" : ""}
                  {number.format(item.variance)} {item.unit}
                </td>
                <td data-label="Statut">
                  <StatusPill status={item.status} />
                </td>
                <td data-label="Actions">
                  <div className="row-actions">
                    <button className="ghost-button compact" type="button" onClick={() => startEditProduct(item)}>
                      <SlidersHorizontal size={15} />
                      <span>Modifier</span>
                    </button>
                    <button className="ghost-button compact danger-lite" type="button" onClick={() => deleteProduct(item.id)}>
                      <XCircle size={15} />
                      <span>Supprimer</span>
                    </button>
                  </div>
                </td>
              </tr>
              {editingProduct?.id === item.id && (
                <tr className="edit-row">
                  <td colSpan="7">
                    <ProductEditForm
                      item={editingProduct}
                      updateEditingProduct={updateEditingProduct}
                      saveProductEdit={saveProductEdit}
                      cancelProductEdit={cancelProductEdit}
                    />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProductSetupForm({ forms, updateForm, createProduct }) {
  return (
    <form className="operation-form setup-form" onSubmit={createProduct}>
      <header>
        <PackageCheck size={20} />
        <h2>Nouveau produit</h2>
      </header>
      <input
        value={forms.productName}
        onChange={(event) => updateForm("productName", event.target.value)}
        placeholder="Nom du produit"
        required
      />
      <div className="form-grid quarters">
        <label className="field-label">
          <span>Catégorie</span>
          <select value={forms.productCategory} onChange={(event) => updateForm("productCategory", event.target.value)}>
            {productCategories.map((entry) => (
              <option key={entry}>{entry}</option>
            ))}
          </select>
        </label>
        <label className="field-label">
          <span>Unité</span>
          <select value={forms.productUnit} onChange={(event) => updateForm("productUnit", event.target.value)}>
            {productUnits.map((entry) => (
              <option key={entry}>{entry}</option>
            ))}
          </select>
        </label>
        <label className="field-label">
          <span>Quantité actuelle en stock ({forms.productUnit})</span>
          <input
            value={forms.productInitialQty}
            onChange={(event) => updateForm("productInitialQty", event.target.value)}
            placeholder={`Ex: 12 ${forms.productUnit}`}
            type="text"
            inputMode="decimal"
            step="0.01"
            min="0"
          />
        </label>
        <label className="field-label">
          <span>Zone de stockage</span>
          <select value={forms.productZone} onChange={(event) => updateForm("productZone", event.target.value)}>
            {productZones.map((entry) => (
              <option key={entry}>{entry}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-grid">
        <label className="field-label">
          <span>Fournisseur</span>
          <input
            value={forms.productSupplier}
            onChange={(event) => updateForm("productSupplier", event.target.value)}
            placeholder="Nom du fournisseur"
          />
        </label>
        <label className="field-label">
          <span>Prix unitaire</span>
          <input
            value={forms.productPrice}
            onChange={(event) => updateForm("productPrice", event.target.value)}
            placeholder="Ex: 8.50"
            type="text"
            inputMode="decimal"
            step="0.01"
            min="0"
          />
        </label>
      </div>
      <div className="form-grid">
        <label className="field-label">
          <span>DLC</span>
          <DateField
            value={forms.productInitialDlc}
            onChange={(value) => updateForm("productInitialDlc", value)}
          />
        </label>
        <label className="field-label">
          <span>DDM</span>
          <DateField
            value={forms.productInitialDdm}
            onChange={(value) => updateForm("productInitialDdm", value)}
          />
        </label>
      </div>
      <div className="form-grid thirds">
        <label className="field-label">
          <span>Conditionnement fournisseur ({forms.productUnit})</span>
          <input
            value={forms.productPackSize}
            onChange={(event) => updateForm("productPackSize", event.target.value)}
            placeholder="Ex: 5"
            type="text"
            inputMode="decimal"
            step="0.01"
            min="0.01"
          />
        </label>
        <label className="field-label">
          <span>Délai de livraison (jours)</span>
          <input
            value={forms.productLeadTime}
            onChange={(event) => updateForm("productLeadTime", event.target.value)}
            placeholder="Ex: 1"
            type="text"
            inputMode="decimal"
            min="0"
          />
        </label>
        <label className="field-label">
          <span>Stock souhaité (jours)</span>
          <input
            value={forms.productTargetDays}
            onChange={(event) => updateForm("productTargetDays", event.target.value)}
            placeholder="Ex: 4"
            type="text"
            inputMode="decimal"
            min="1"
          />
        </label>
      </div>
      <button className="primary-button" type="submit">
        <Plus size={17} />
        <span>Ajouter produit</span>
      </button>
    </form>
  );
}

function ProductEditForm({ item, updateEditingProduct, saveProductEdit, cancelProductEdit }) {
  return (
    <form className="product-edit-form" onSubmit={saveProductEdit}>
      <div className="form-grid thirds">
        <label className="field-label">
          <span>Nom</span>
          <input value={item.name} onChange={(event) => updateEditingProduct("name", event.target.value)} required />
        </label>
        <label className="field-label">
          <span>Catégorie</span>
          <select value={item.category} onChange={(event) => updateEditingProduct("category", event.target.value)}>
            {productCategories.map((entry) => (
              <option key={entry}>{entry}</option>
            ))}
          </select>
        </label>
        <label className="field-label">
          <span>Unité</span>
          <select value={item.unit} onChange={(event) => updateEditingProduct("unit", event.target.value)}>
            {productUnits.map((entry) => (
              <option key={entry}>{entry}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-grid thirds">
        <label className="field-label">
          <span>Zone de stockage</span>
          <select value={item.zone} onChange={(event) => updateEditingProduct("zone", event.target.value)}>
            {productZones.map((entry) => (
              <option key={entry}>{entry}</option>
            ))}
          </select>
        </label>
        <label className="field-label">
          <span>Fournisseur</span>
          <input value={item.supplier} onChange={(event) => updateEditingProduct("supplier", event.target.value)} />
        </label>
        <label className="field-label">
          <span>Prix unitaire</span>
          <input
            value={item.price}
            onChange={(event) => updateEditingProduct("price", event.target.value)}
            type="text"
            inputMode="decimal"
            min="0"
            step="0.01"
          />
        </label>
      </div>
      <div className="form-grid quarters">
        <label className="field-label">
          <span>Quantité actuelle en stock ({item.unit})</span>
          <input
            value={item.stockQty}
            onChange={(event) => updateEditingProduct("stockQty", event.target.value)}
            type="text"
            inputMode="decimal"
            min="0"
            step="0.01"
          />
        </label>
        <label className="field-label">
          <span>Conditionnement fournisseur ({item.unit})</span>
          <input
            value={item.packSize}
            onChange={(event) => updateEditingProduct("packSize", event.target.value)}
            type="text"
            inputMode="decimal"
            min="0.01"
            step="0.01"
          />
        </label>
        <label className="field-label">
          <span>Durée par défaut avant DLC/DDM</span>
          <input
            value={item.shelfLife}
            onChange={(event) => updateEditingProduct("shelfLife", event.target.value)}
            type="text"
            inputMode="decimal"
            min="1"
          />
        </label>
        <label className="field-label">
          <span>Délai de livraison (jours)</span>
          <input
            value={item.leadTime}
            onChange={(event) => updateEditingProduct("leadTime", event.target.value)}
            type="text"
            inputMode="decimal"
            min="0"
          />
        </label>
      </div>
      <div className="form-grid compact-line">
        <label className="field-label">
          <span>Stock souhaité (jours)</span>
          <input
            value={item.targetDays}
            onChange={(event) => updateEditingProduct("targetDays", event.target.value)}
            type="text"
            inputMode="decimal"
            min="1"
          />
        </label>
        <div className="edit-actions">
          <button className="ghost-button" type="button" onClick={cancelProductEdit}>
            <XCircle size={17} />
            <span>Annuler</span>
          </button>
          <button className="primary-button" type="submit">
            <CheckCircle2 size={17} />
            <span>Enregistrer</span>
          </button>
        </div>
      </div>
    </form>
  );
}

function EmptyState({ icon: Icon, title, body }) {
  return (
    <div className="empty-state">
      <Icon size={22} />
      <div>
        <strong>{title}</strong>
        <span>{body}</span>
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  const Icon = status === "Critique" ? XCircle : status === "Stable" ? CheckCircle2 : AlertTriangle;
  const statusClass = normalizeText(status).replace(/\s+/g, "-");
  return (
    <span className={`status-pill ${statusClass}`}>
      <Icon size={14} />
      {status}
    </span>
  );
}

function LotDatePills({ lot, unit, showQty = false }) {
  const entries = lotDateEntries(lot);
  return entries.map((entry, index) => (
    <span className={entry.offset <= 1 ? "hot" : ""} key={`${lot.id}-${entry.type}`}>
      {entry.type} {dateLabel(entry.offset)}
      {showQty && index === 0 ? ` · ${number.format(lot.qty)} ${unit}` : ""}
    </span>
  ));
}

function Recipes({
  menuInsights,
  inventory,
  ingredients,
  stations,
  addStation,
  forms,
  updateForm,
  addRecipeLine,
  updateRecipeLineQty,
  updateRecipeLineUnit,
  removeRecipeLine,
  createRecipe,
}) {
  const inventoryMap = new Map(inventory.map((item) => [item.id, item]));

  return (
    <section className="content-stack">
      <RecipeSetupForm
        ingredients={ingredients}
        stations={stations}
        addStation={addStation}
        forms={forms}
        updateForm={updateForm}
        addRecipeLine={addRecipeLine}
        updateRecipeLineQty={updateRecipeLineQty}
        updateRecipeLineUnit={updateRecipeLineUnit}
        removeRecipeLine={removeRecipeLine}
        createRecipe={createRecipe}
      />

      {menuInsights.length === 0 ? (
        <EmptyState
          icon={ChefHat}
          title="Aucune recette"
          body={ingredients.length ? "Crée une recette pour calculer son coût et relier les ventes au stock." : "Ajoute un produit avant de créer une recette."}
        />
      ) : (
        <div className="recipe-grid">
          {menuInsights.map((recipe) => (
            <article className="recipe-card" key={recipe.id}>
              <header>
                <div>
                  <span>{recipe.station}</span>
                  <h3>{recipe.name}</h3>
                </div>
                <strong className={foodCostTier(recipe.foodCostPct)}>{number.format(recipe.foodCostPct)}%</strong>
              </header>
              <div className="margin-line">
                <span>Coût portion</span>
                <strong>{preciseMoney.format(recipe.ingredientCost)}</strong>
                <span>Marge brute</span>
                <strong>{preciseMoney.format(recipe.grossMargin)}</strong>
              </div>
              <div className="ingredient-chips">
                {recipe.ingredients.map((line) => {
                  const item = inventoryMap.get(line.id);
                  return (
                    <span className={item?.stockoutRisk ? "danger" : item?.expiryRisk ? "warning" : ""} key={line.id}>
                      {item?.name}: {formatPortionQty(line.qty, item?.unit)}
                    </span>
                  );
                })}
              </div>
              <footer>
                <ReceiptText size={16} />
                <span>{recipe.action}</span>
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function foodCostTier(pct) {
  if (pct <= 30) return "good";
  if (pct <= 35) return "warn";
  return "high";
}

// Segment d'unité : liste déroulante si plusieurs choix (g/kg, ml/L), sinon libellé figé.
function UnitSelect({ baseUnit, value, onChange, ariaLabel }) {
  const options = entryUnitsFor(baseUnit);
  if (options.length <= 1) {
    return <span className="qty-unit">{unitMeta(value).label}</span>;
  }
  return (
    <select
      className="qty-unit qty-unit-select"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel || "Unité"}
    >
      {options.map((unit) => (
        <option key={unit} value={unit}>
          {unitMeta(unit).label}
        </option>
      ))}
    </select>
  );
}

function RecipeSetupForm({
  ingredients,
  stations,
  addStation,
  forms,
  updateForm,
  addRecipeLine,
  updateRecipeLineQty,
  updateRecipeLineUnit,
  removeRecipeLine,
  createRecipe,
}) {
  const ingredientMap = new Map(ingredients.map((item) => [item.id, item]));
  const lines = forms.recipeLines || [];
  const selected = ingredientMap.get(forms.recipeIngredient);
  const baseUnit = selected?.unit;
  const addUnitKey = resolveEntryUnit(forms.recipeUnit, baseUnit);
  const addMeta = unitMeta(addUnitKey);

  const [addingStation, setAddingStation] = useState(false);
  const [newStation, setNewStation] = useState("");

  function confirmStation() {
    const value = newStation.trim();
    if (!value) return;
    addStation(value);
    setNewStation("");
    setAddingStation(false);
  }

  function cancelStation() {
    setNewStation("");
    setAddingStation(false);
  }

  function pickIngredient(value) {
    updateForm("recipeIngredient", value);
    updateForm("recipeUnit", resolveEntryUnit(forms.recipeUnit, ingredientMap.get(value)?.unit));
  }

  function changeAddUnit(nextUnit) {
    const current = parseFormNumber(forms.recipeQty);
    if (current > 0) {
      updateForm("recipeQty", fromBaseEntry(toBaseQty(current, addUnitKey, baseUnit), nextUnit, baseUnit));
    }
    updateForm("recipeUnit", nextUnit);
  }

  const cost = recipeIngredientCost(lines, ingredientMap);
  const price = parseFormNumber(forms.recipePrice) || 0;
  const margin = price - cost;
  const foodCostPct = price > 0 && cost > 0 ? (cost / price) * 100 : 0;
  const hasData = lines.length > 0 && price > 0;

  let tier = "idle";
  let verdict = "Ajoute des ingrédients et un prix pour voir la marge.";
  if (hasData) {
    if (foodCostPct <= 30) {
      tier = "good";
      verdict = "Marge saine — tu peux garder ce prix.";
    } else if (foodCostPct <= 35) {
      tier = "warn";
      verdict = "Marge correcte, surveille le grammage.";
    } else {
      tier = "high";
      verdict = "Trop cher — baisse le grammage ou monte le prix.";
    }
  }

  if (!ingredients.length) {
    return (
      <form className="operation-form recipe-builder" onSubmit={createRecipe}>
        <header>
          <ReceiptText size={20} />
          <h2>Nouvelle recette</h2>
        </header>
        <p className="builder-hint">Ajoute d'abord un produit dans « Produits & stock » pour pouvoir composer une recette.</p>
      </form>
    );
  }

  return (
    <form className="operation-form recipe-builder" onSubmit={createRecipe}>
      <header>
        <ReceiptText size={20} />
        <h2>Nouvelle recette</h2>
      </header>

      <div className="builder-section">
        <div className="form-grid">
          <label className="field-label">
            <span>Nom du plat</span>
            <input
              value={forms.recipeName}
              onChange={(event) => updateForm("recipeName", event.target.value)}
              placeholder="ex. Burger maison"
              required
            />
          </label>
          <div className="field-label">
            <span>Poste</span>
            {addingStation ? (
              <div className="station-add">
                <input
                  autoFocus
                  value={newStation}
                  onChange={(event) => setNewStation(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      confirmStation();
                    }
                    if (event.key === "Escape") cancelStation();
                  }}
                  placeholder="ex. Pizza, Pâtisserie…"
                />
                <button type="button" className="icon-button confirm" onClick={confirmStation} aria-label="Ajouter le poste">
                  <Check size={18} />
                </button>
                <button type="button" className="icon-button" onClick={cancelStation} aria-label="Annuler">
                  <XCircle size={18} />
                </button>
              </div>
            ) : (
              <div className="station-pick">
                <select value={forms.recipeStation} onChange={(event) => updateForm("recipeStation", event.target.value)}>
                  {stations.map((station) => (
                    <option value={station} key={station}>
                      {station}
                    </option>
                  ))}
                </select>
                <button type="button" className="ghost-button compact" onClick={() => setAddingStation(true)}>
                  <Plus size={16} />
                  <span>Poste</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="builder-section">
        <p className="builder-eyebrow">Quantités pour une portion</p>
        <div className="ingredient-add-row">
          <SelectField
            value={forms.recipeIngredient}
            onChange={pickIngredient}
            ingredients={ingredients}
          />
          <div className="qty-field">
            <input
              value={forms.recipeQty}
              onChange={(event) => updateForm("recipeQty", event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addRecipeLine();
                }
              }}
              placeholder={`ex. ${addMeta.placeholder}`}
              type="text"
              inputMode="decimal"
              step={addMeta.step}
              min="0"
              aria-label="Quantité par portion"
            />
            <UnitSelect baseUnit={baseUnit} value={addUnitKey} onChange={changeAddUnit} ariaLabel="Unité de saisie" />
          </div>
          <button className="ghost-button strong" type="button" onClick={addRecipeLine} disabled={!parseFormNumber(forms.recipeQty)}>
            <Plus size={17} />
            <span>Ajouter</span>
          </button>
        </div>

        {lines.length > 0 ? (
          <ul className="recipe-line-list">
            {lines.map((line, index) => {
              const item = ingredientMap.get(line.id);
              const lineUnitKey = resolveEntryUnit(line.unit, item?.unit);
              const lineMeta = unitMeta(lineUnitKey);
              const lineCost = recipeIngredientCost([line], ingredientMap);
              return (
                <li className="recipe-line" key={`${line.id}-${index}`}>
                  <span className="recipe-line-name">{item?.name || line.id}</span>
                  <div className="qty-field compact">
                    <input
                      value={line.raw ?? fromBaseEntry(line.qty, lineUnitKey, item?.unit)}
                      onChange={(event) => updateRecipeLineQty(index, event.target.value)}
                      type="text"
                      inputMode="decimal"
                      step={lineMeta.step}
                      min="0"
                      aria-label={`Quantité ${item?.name || ""}`}
                    />
                    <UnitSelect
                      baseUnit={item?.unit}
                      value={lineUnitKey}
                      onChange={(unit) => updateRecipeLineUnit(index, unit)}
                      ariaLabel={`Unité ${item?.name || ""}`}
                    />
                  </div>
                  <span className="recipe-line-cost">{preciseMoney.format(lineCost)}</span>
                  <button
                    type="button"
                    className="recipe-line-remove"
                    onClick={() => removeRecipeLine(index)}
                    aria-label={`Retirer ${item?.name || "l'ingrédient"}`}
                  >
                    <XCircle size={18} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="builder-hint">
            Choisis un produit, tape la quantité en {addMeta.label}, puis « Ajouter ».
          </p>
        )}
      </div>

      <div className="builder-section">
        <p className="builder-eyebrow">Prix & marge</p>
        <div className="form-grid">
          <label className="field-label">
            <span>Prix de vente</span>
            <div className="qty-field">
              <input
                value={forms.recipePrice}
                onChange={(event) => updateForm("recipePrice", event.target.value)}
                placeholder="ex. 22.00"
                type="text"
                inputMode="decimal"
                step="0.5"
                min="0"
                required
              />
              <span className="qty-unit">CHF</span>
            </div>
          </label>
          <label className="field-label">
            <span>Ventes moyennes par jour</span>
            <input
              value={forms.recipeDailyBase}
              onChange={(event) => updateForm("recipeDailyBase", event.target.value)}
              placeholder="20"
              type="text"
              inputMode="decimal"
              min="1"
            />
          </label>
        </div>

        <div className={`margin-bar ${tier}`}>
          <div className="margin-stat">
            <span>Coût portion</span>
            <strong>{preciseMoney.format(cost)}</strong>
          </div>
          <div className="margin-stat">
            <span>Marge brute</span>
            <strong>{preciseMoney.format(margin)}</strong>
          </div>
          <div className="margin-stat accent">
            <span>Food cost</span>
            <strong>{hasData ? `${number.format(foodCostPct)}%` : "—"}</strong>
          </div>
          <p className="margin-verdict">{verdict}</p>
        </div>
      </div>

      <button className="primary-button builder-submit" type="submit" disabled={lines.length === 0 && !parseFormNumber(forms.recipeQty)}>
        <Plus size={18} />
        <span>Créer la recette</span>
      </button>
    </form>
  );
}

function TraceabilityRegister({
  intelligence,
  createSecondaryLabel,
  exportAutocontrol,
}) {
  const swiss = intelligence.swissAutocontrol;
  const actionItems = [
    ...swiss.blockedLots.map((lot) => ({
      id: `blocked-${lot.id}`,
      status: "attention",
      title: `Isoler ${lot.ingredientName}`,
      body: `Lot ${lot.lot} - ${lotDateText(lot)}`,
    })),
    ...swiss.secondaryMissing.map((lot) => ({
      id: `label-${lot.id}`,
      status: "todo",
      title: `Étiquette interne ${lot.ingredientName}`,
      body: `Lot ${lot.lot} - produit ouvert, date interne manquante`,
      action: () => createSecondaryLabel(lot.id),
      actionLabel: "Générer",
    })),
    ...swiss.incompleteLots.map((lot) => ({
      id: `incomplete-${lot.id}`,
      status: "todo",
      title: `Compléter ${lot.ingredientName}`,
      body: `Lot ${lot.lot} - fournisseur, réception ou DLC/DDM à vérifier`,
    })),
  ];
  const nextAction = actionItems[0]?.title || "Registre à jour";

  return (
    <section className="compliance-layout">
      <div className="panel compliance-hero">
        <div>
          <p className="eyebrow">Registre suisse</p>
          <h2>{nextAction}</h2>
          <div className="compliance-metrics">
            <span>
              <strong>{swiss.lotRegister.length}</strong>
              lots reçus
            </span>
            <span>
              <strong>{actionItems.length}</strong>
              à traiter
            </span>
            <span>
              <strong>{swiss.traceOk}%</strong>
              traçabilité
            </span>
          </div>
        </div>
        <button className="primary-button" type="button" onClick={exportAutocontrol}>
          <FileText size={17} />
          <span>Exporter</span>
        </button>
      </div>

      <div className="panel checklist-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Actions</p>
            <h2>À traiter</h2>
          </div>
          <button className="ghost-button compact" type="button" onClick={exportAutocontrol}>
            <FileText size={16} />
            <span>CSV</span>
          </button>
        </div>
        <div className="check-list">
          {actionItems.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="Rien à traiter" body="Les lots et les actions sont à jour." />
          ) : (
            actionItems.map((item) => (
              <article className={`check-row ${item.status}`} key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                </div>
                {item.action && (
                  <button className="ghost-button compact" type="button" onClick={item.action}>
                    <ShieldCheck size={15} />
                    <span>{item.actionLabel}</span>
                  </button>
                )}
              </article>
            ))
          )}
        </div>
      </div>

      <div className="panel evidence-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Preuves</p>
            <h2>Journal exportable</h2>
          </div>
          <FileText size={22} />
        </div>
        <div className="evidence-list">
          <article>
            <strong>Bons de livraison</strong>
            <span>Fournisseur, réception, produit, quantité, lot.</span>
          </article>
          <article>
            <strong>DLC/DDM</strong>
            <span>Dates fournisseur et dates internes des produits ouverts.</span>
          </article>
          <article>
            <strong>Actions correctives</strong>
            <span>Pertes, isolations, retours fournisseur et etiquettes.</span>
          </article>
        </div>
      </div>

      <div className="panel trace-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Lots</p>
            <h2>DLC/DDM & fournisseurs</h2>
          </div>
          <Tag size={22} />
        </div>
        {swiss.lotRegister.length === 0 ? (
          <EmptyState icon={Tag} title="Aucun lot" body="Les lots apparaîtront après une réception." />
        ) : (
          <div className="trace-table">
            <table>
              <thead>
                <tr>
                  <th>Lot</th>
                  <th>Produit</th>
                  <th>Réception</th>
                  <th>DLC/DDM</th>
                  <th>Interne</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {swiss.lotRegister.slice(0, 12).map((lot) => (
                  <tr key={lot.id}>
                    <td>
                      <strong>{lot.lot}</strong>
                      <span>{lotDateTypeLabel(lot)}</span>
                    </td>
                    <td>
                      <div className="product-cell">
                        <strong>{lot.ingredientName}</strong>
                        <span>
                          {lot.supplier} - {lot.zone}
                        </span>
                      </div>
                    </td>
                    <td>{dateLabel(lot.receivedOffset)}</td>
                    <td className={lot.dateExpired ? "negative" : lot.expiryOffset <= 2 ? "warning-text" : ""}>
                      <div className="lot-stack">
                        <LotDatePills lot={lot} />
                      </div>
                    </td>
                    <td>
                      {lot.opened ? (
                        lot.needsSecondary ? (
                          <button className="link-btn" type="button" onClick={() => createSecondaryLabel(lot.id)}>
                            Générer
                          </button>
                        ) : (
                          dateLabel(lot.secondaryOffset)
                        )
                      ) : (
                        "fermé"
                      )}
                    </td>
                    <td>
                      <span className={`trace-status ${lot.status.toLowerCase().replace(" ", "-")}`}>
                        {lot.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function Compliance({
  intelligence,
  checks,
  signControl,
  createSecondaryLabel,
  exportAutocontrol,
}) {
  const swiss = intelligence.swissAutocontrol;
  const scoreStyle = {
    background: `conic-gradient(#087f8c ${swiss.score * 3.6}deg, #eceae3 0deg)`,
  };

  return (
    <section className="compliance-layout">
      <div className="panel compliance-hero">
        <div>
          <p className="eyebrow">Registre Suisse</p>
          <h2>{swiss.nextAction}</h2>
          <div className="compliance-metrics">
            <span>
              <strong>{swiss.traceOk}%</strong>
              traçabilité
            </span>
            <span>
              <strong>{swiss.blockedLots.length}</strong>
              lots bloqués
            </span>
            <span>
              <strong>{swiss.secondaryMissing.length}</strong>
              étiquettes
            </span>
          </div>
        </div>
        <div className="score-ring" style={scoreStyle}>
          <div>
            <strong>{swiss.score}</strong>
            <span>/100</span>
          </div>
        </div>
      </div>

      <div className="panel checklist-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Actions</p>
            <h2>Registre du jour</h2>
          </div>
          <button className="ghost-button compact" type="button" onClick={exportAutocontrol}>
            <FileText size={16} />
            <span>CSV</span>
          </button>
        </div>
        <div className="check-list">
          {checks.map((check) => (
            <article className={`check-row ${check.status}`} key={check.id}>
              <div>
                <strong>{check.label}</strong>
                <span>
                  {check.area} · {check.due} · {check.evidence}
                </span>
              </div>
              {check.status === "done" ? (
                <span className="signed-pill">
                  <CheckCircle2 size={14} />
                  Signé
                </span>
              ) : (
                <button className="ghost-button compact" type="button" onClick={() => signControl(check.id)}>
                  <ShieldCheck size={15} />
                  <span>Signer</span>
                </button>
              )}
            </article>
          ))}
        </div>
      </div>

      <div className="panel evidence-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Preuves</p>
            <h2>À garder sous la main</h2>
          </div>
          <FileText size={22} />
        </div>
        <div className="evidence-list">
          <article>
            <strong>Factures / bons de livraison</strong>
            <span>Relier fournisseur, date, produit, quantité et lot.</span>
          </article>
          <article>
            <strong>Étiquettes DLC/DDM</strong>
            <span>Conserver l'information utile dans le registre, surtout pour les produits sensibles.</span>
          </article>
          <article>
            <strong>Actions correctives</strong>
            <span>Signer les pertes, isolations, retours fournisseur et étiquettes secondaires.</span>
          </article>
        </div>
      </div>

      <div className="panel trace-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Lots</p>
            <h2>Traçabilité DLC/DDM</h2>
          </div>
          <Tag size={22} />
        </div>
        <div className="trace-table">
          <table>
            <thead>
              <tr>
                <th>Lot</th>
                <th>Produit</th>
                <th>Réception</th>
                <th>DLC/DDM</th>
                <th>Interne</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {swiss.lotRegister.slice(0, 12).map((lot) => (
                <tr key={lot.id}>
                  <td>
                    <strong>{lot.lot}</strong>
                    <span>{lotDateTypeLabel(lot)}</span>
                  </td>
                  <td>
                    <div className="product-cell">
                      <strong>{lot.ingredientName}</strong>
                      <span>
                        {lot.supplier} · {lot.zone}
                      </span>
                    </div>
                  </td>
                  <td>{dateLabel(lot.receivedOffset)}</td>
                  <td className={lot.dateExpired ? "negative" : lot.expiryOffset <= 2 ? "warning-text" : ""}>
                    <div className="lot-stack">
                      <LotDatePills lot={lot} />
                    </div>
                  </td>
                  <td>
                    {lot.opened ? (
                      lot.needsSecondary ? (
                        <button className="link-btn" type="button" onClick={() => createSecondaryLabel(lot.id)}>
                          Générer
                        </button>
                      ) : (
                        dateLabel(lot.secondaryOffset)
                      )
                    ) : (
                      "fermé"
                    )}
                  </td>
                  <td>
                    <span className={`trace-status ${lot.status.toLowerCase().replace(" ", "-")}`}>
                      {lot.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Operations({
  ingredients,
  inventory,
  logs,
  forms,
  updateForm,
  receiveDelivery,
  countStock,
  logWaste,
  countAdvice = [],
  setActiveTab,
  loadDemoData,
}) {
  const countItem = inventory.find((item) => item.id === forms.countIngredient);
  const theoretical = countItem?.currentStock ?? 0;
  const countUnit = countItem?.unit ?? "";
  const step = countUnit === "piece" ? 1 : 0.5;
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanStatus, setScanStatus] = useState("");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const scanFrameRef = useRef(null);
  const ecart = forms.countQty === "" ? null : round(parseFormNumber(forms.countQty) - theoretical, 2);
  const inventoryGap =
    ecart === null || ecart === 0
      ? null
      : {
          tone: ecart < 0 ? "negative" : "positive",
          title: ecart < 0 ? "Stock réel inférieur" : "Stock réel supérieur",
          body:
            ecart < 0
              ? `Il manque ${number.format(Math.abs(ecart))} ${countUnit}. Vérifier une perte, une utilisation ou une erreur de saisie.`
              : `Il y a ${number.format(ecart)} ${countUnit} en plus. Vérifier une livraison, un retour ou une erreur de saisie.`,
        };

  function stopScanner() {
    if (scanFrameRef.current) {
      window.cancelAnimationFrame(scanFrameRef.current);
      scanFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }

  function applyReceiveCode(rawCode = forms.receiveCode) {
    const code = String(rawCode || "").trim();
    updateForm("receiveCode", code);
    if (!code) {
      setScanStatus("Code vide.");
      return false;
    }

    const matched = ingredients.find((item) => {
      const barcode = String(item.barcode || "").trim();
      return barcode && normalizeText(barcode) === normalizeText(code);
    });

    if (matched) {
      updateForm("receiveIngredient", matched.id);
      setScanStatus(`${matched.name} sélectionné.`);
      return true;
    }

    setScanStatus("Code non reconnu. Saisie manuelle disponible.");
    return false;
  }

  useEffect(() => {
    if (!scannerOpen) return undefined;
    let cancelled = false;

    async function startScanner() {
      if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) {
        setScanStatus("Scanner caméra non disponible ici. Saisie manuelle disponible.");
        setScannerOpen(false);
        return;
      }

      try {
        const detector = new window.BarcodeDetector({
          formats: ["qr_code", "ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e"],
        });
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const value = codes[0]?.rawValue;
            if (value) {
              applyReceiveCode(value);
              setScannerOpen(false);
              return;
            }
          } catch {
            // Some browsers need a few frames before the video is detectable.
          }
          scanFrameRef.current = window.requestAnimationFrame(tick);
        };
        setScanStatus("Scanner actif.");
        tick();
      } catch {
        setScanStatus("Caméra indisponible. Saisie manuelle disponible.");
        setScannerOpen(false);
      }
    }

    startScanner();
    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [scannerOpen, ingredients]);

  function adjustCount(delta) {
    const base = forms.countQty === "" ? theoretical : parseFormNumber(forms.countQty) || 0;
    updateForm("countQty", String(Math.max(0, round(base + delta, 2))));
  }

  function handleCount(event) {
    countStock(event);
    const actual = parseFormNumber(forms.countQty);
    if (forms.countQty === "" || Number.isNaN(actual) || actual < 0) return;
    const order = inventory.map((item) => item.id);
    const index = order.indexOf(forms.countIngredient);
    if (index >= 0 && order.length) updateForm("countIngredient", order[(index + 1) % order.length]);
  }

  if (!ingredients.length) {
    return (
      <section className="content-stack">
        <div className="panel empty-panel movement-empty">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Mouvements</p>
              <h2>Stock vide</h2>
              <p>Crée d'abord un produit pour pouvoir recevoir une livraison, corriger le stock réel ou enregistrer une perte.</p>
            </div>
            <PackageOpen size={22} />
          </div>
          <div className="setup-actions">
            <button className="primary-button" type="button" onClick={() => setActiveTab("stock")}>
              <Plus size={17} />
              <span>Créer un produit</span>
            </button>
            <button className="ghost-button" type="button" onClick={loadDemoData}>
              <PackageOpen size={17} />
              <span>Charger une démo</span>
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="operations-layout">
      <form className="operation-form" onSubmit={receiveDelivery}>
        <header>
          <PackageCheck size={20} />
          <h2>Livraison reçue</h2>
        </header>
        <div className="scan-field">
          <span className="scan-label">Code-barres / QR</span>
          <div className="scan-row">
            <input
              value={forms.receiveCode}
              onChange={(event) => updateForm("receiveCode", event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyReceiveCode();
                }
              }}
              placeholder="Scanner ou saisir le code"
              type="text"
              inputMode="numeric"
              aria-label="Code-barres / QR réception"
            />
            <button className="ghost-button compact" type="button" onClick={() => applyReceiveCode()}>
              <Search size={15} />
              <span>Chercher</span>
            </button>
            <button className="ghost-button compact" type="button" onClick={() => setScannerOpen((open) => !open)}>
              <Camera size={15} />
              <span>{scannerOpen ? "Stop" : "Scanner"}</span>
            </button>
          </div>
          {scanStatus && <p className="scan-status">{scanStatus}</p>}
          {scannerOpen && (
            <div className="scanner-preview">
              <video ref={videoRef} muted playsInline />
            </div>
          )}
        </div>
        <label className="field-label">
          <span>Produit livré</span>
          <SelectField value={forms.receiveIngredient} onChange={(value) => updateForm("receiveIngredient", value)} ingredients={ingredients} />
        </label>
        <div className="form-grid">
          <label className="field-label">
            <span>Quantité reçue</span>
            <input value={forms.receiveQty} onChange={(event) => updateForm("receiveQty", event.target.value)} placeholder="Ex: 12" type="text" inputMode="decimal" step="0.01" />
          </label>
          <label className="field-label">
            <span>Prix facture / unité</span>
            <input value={forms.receivePrice} onChange={(event) => updateForm("receivePrice", event.target.value)} placeholder="Ex: 8.50" type="text" inputMode="decimal" step="0.01" />
          </label>
        </div>
        <div className="form-grid">
          <label className="field-label">
            <span>DLC</span>
            <DateField
              value={forms.receiveDlc}
              onChange={(value) => updateForm("receiveDlc", value)}
            />
          </label>
          <label className="field-label">
            <span>DDM</span>
            <DateField
              value={forms.receiveDdm}
              onChange={(value) => updateForm("receiveDdm", value)}
            />
          </label>
        </div>
        <button className="primary-button" type="submit">
          <Plus size={17} />
          <span>Ajouter au stock</span>
        </button>
      </form>

      <form className="operation-form" onSubmit={handleCount}>
        <header>
          <ClipboardList size={20} />
          <h2>Stock réel</h2>
        </header>
        {countAdvice.length > 0 && (
          <div className="count-priority-strip">
            {countAdvice.slice(0, 3).map((item) => (
              <button
                type="button"
                key={item.id}
                className={item.severity}
                onClick={() => {
                  updateForm("countIngredient", item.id);
                  updateForm("countQty", "");
                }}
              >
                <span>{item.name}</span>
                <small>{item.reason}</small>
              </button>
            ))}
          </div>
        )}
        <label className="field-label">
          <span>Produit à compter</span>
          <SelectField value={forms.countIngredient} onChange={(value) => updateForm("countIngredient", value)} ingredients={ingredients} />
        </label>
        <div className="count-theory">
          <span>Stock calculé</span>
          <strong>
            {number.format(theoretical)} {countUnit}
          </strong>
        </div>
        <div className="field-label">
          <span>Quantité réellement trouvée</span>
        <div className="stepper">
          <button type="button" className="step-btn" onClick={() => adjustCount(-step)} aria-label="Diminuer">
            <Minus size={20} />
          </button>
          <input
            value={forms.countQty}
            onChange={(event) => updateForm("countQty", event.target.value)}
            placeholder="0"
            type="text"
            step="0.01"
            inputMode="decimal"
          />
          <button type="button" className="step-btn" onClick={() => adjustCount(step)} aria-label="Augmenter">
            <Plus size={20} />
          </button>
        </div>
        </div>
        <div className="count-feedback">
          <button type="button" className="link-btn" onClick={() => updateForm("countQty", String(theoretical))}>
            Garder la valeur calculée
          </button>
          {ecart !== null && (
            <span className={`ecart ${ecart < 0 ? "neg" : ecart > 0 ? "pos" : "zero"}`}>
              écart {ecart >= 0 ? "+" : ""}
              {number.format(ecart)} {countUnit}
            </span>
          )}
        </div>
        {inventoryGap && (
          <div className={`count-warning ${inventoryGap.tone}`}>
            <AlertTriangle size={18} />
            <div>
              <strong>{inventoryGap.title}</strong>
              <span>{inventoryGap.body}</span>
            </div>
          </div>
        )}
        <button className="ghost-button strong" type="submit">
          <ShieldCheck size={17} />
          <span>Valider le stock réel</span>
          <ChevronRight size={16} />
        </button>
      </form>

      <form className="operation-form" onSubmit={logWaste}>
        <header>
          <PackageOpen size={20} />
          <h2>Perte / casse</h2>
        </header>
        <label className="field-label">
          <span>Produit à retirer</span>
          <SelectField value={forms.wasteIngredient} onChange={(value) => updateForm("wasteIngredient", value)} ingredients={ingredients} />
        </label>
        <div className="form-grid">
          <label className="field-label">
            <span>Quantité retirée</span>
            <input value={forms.wasteQty} onChange={(event) => updateForm("wasteQty", event.target.value)} placeholder="Ex: 1.5" type="text" inputMode="decimal" step="0.01" />
          </label>
          <label className="field-label">
            <span>Motif</span>
            <select value={forms.wasteReason} onChange={(event) => updateForm("wasteReason", event.target.value)}>
              <option>DLC / qualité</option>
              <option>Surproduction</option>
              <option>Cuisson ratée</option>
              <option>Portionnage</option>
              <option>Retour assiette</option>
              <option>Casse / renversé</option>
              <option>Offert / repas équipe</option>
            </select>
          </label>
        </div>
        <button className="danger-button" type="submit">
          <AlertTriangle size={17} />
          <span>Enregistrer la perte</span>
        </button>
      </form>

      <div className="panel log-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Journal</p>
            <h2>Mouvements récents</h2>
          </div>
          <Warehouse size={22} />
        </div>
        <div className="log-list">
          {logs.length === 0 && <EmptyState icon={Warehouse} title="Aucun mouvement" body="Les réceptions, inventaires et pertes apparaîtront ici." />}
          {logs.slice(0, 8).map((log) => (
            <article key={log.id}>
              <span>{log.time}</span>
              <strong>{log.type}</strong>
              <p>
                {log.item} · {log.qty}
              </p>
              <small>{log.note}</small>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function SelectField({ value, onChange, ingredients }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} disabled={!ingredients.length}>
      {ingredients.length === 0 ? (
        <option value="">Aucun produit</option>
      ) : (
        ingredients.map((item) => (
          <option value={item.id} key={item.id}>
            {item.name}
          </option>
        ))
      )}
    </select>
  );
}

const DATE_WEEKDAYS = ["lu", "ma", "me", "je", "ve", "sa", "di"];
const DATE_MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseISODate(value) {
  if (!value) return null;
  const [y, m, d] = String(value).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function isSameDay(a, b) {
  return (
    a && b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function DateField({ value, onChange, placeholder = "Choisir une date" }) {
  const [open, setOpen] = useState(false);
  const selected = parseISODate(value);
  const today = new Date();
  const [view, setView] = useState(() => selected || today);
  const ref = useRef(null);

  useEffect(() => {
    if (open && selected) setView(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(event) {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const firstOfMonth = new Date(view.getFullYear(), view.getMonth(), 1);
  const startWeekday = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(1 - startWeekday);
  const days = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    return day;
  });

  const label = selected
    ? selected.toLocaleDateString("fr-CH", { day: "2-digit", month: "long", year: "numeric" })
    : placeholder;

  function pick(day) {
    onChange(toISODate(day));
    setOpen(false);
  }

  return (
    <div className="date-field" ref={ref}>
      <button
        type="button"
        className={`date-field-trigger${selected ? "" : " empty"}`}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Calendar size={16} />
        <span>{label}</span>
      </button>
      {open && (
        <div className="date-popover" role="dialog" aria-label="Choisir une date">
          <div className="date-popover-head">
            <button
              type="button"
              onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
              aria-label="Mois précédent"
            >
              <ChevronLeft size={16} />
            </button>
            <strong>
              {DATE_MONTHS[view.getMonth()]} {view.getFullYear()}
            </strong>
            <button
              type="button"
              onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
              aria-label="Mois suivant"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="date-weekdays">
            {DATE_WEEKDAYS.map((weekday) => (
              <span key={weekday}>{weekday}</span>
            ))}
          </div>
          <div className="date-grid">
            {days.map((day) => {
              const outside = day.getMonth() !== view.getMonth();
              const todayCell = isSameDay(day, today);
              const selectedCell = isSameDay(day, selected);
              return (
                <button
                  type="button"
                  key={toISODate(day)}
                  className={`date-cell${outside ? " outside" : ""}${todayCell ? " today" : ""}${selectedCell ? " selected" : ""}`}
                  onClick={() => pick(day)}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
          <div className="date-popover-foot">
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              Effacer
            </button>
            <button type="button" className="link-btn" onClick={() => pick(today)}>
              Aujourd'hui
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

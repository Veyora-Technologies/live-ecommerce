import { parseMajorAmountToMinor } from "@/lib/money";

export type ParsedQuery = {
  original: string;
  q: string;
  category?: string;
  brand?: string;
  maxPrice?: number; // whole NGN, only when safely parsed
  minPrice?: number;
  priceFilterInvalid?: boolean;
  area?: string;
  distanceKm?: number;
  openNow?: boolean;
  pickup?: boolean;
  delivery?: boolean;
  verified?: boolean;
  inStock?: boolean;
  freshnessHours?: number;
  timeWindow?: string;
  sort?: string;
  intent: "search" | "compare" | "reserve" | "availability" | "directions";
  confidence: number; // 0-1
  clarifications?: string[];
};

const ABUJA_AREAS = ["wuse","garki","maitama","asokoro","wuye","jabi","utako","gwarimpa","kubwa","central area","durumi","lokogoma","asokoro","apo"];
const CATEGORY_ALIASES: Record<string,string> = {
  "pharmacy":"Pharmacy","pharmacies":"Pharmacy","chemist":"Pharmacy","drug store":"Pharmacy",
  "supermarket":"Supermarket","grocery":"Grocery","groceries":"Grocery",
  "provisions":"Essentials","provisions store":"Essentials",
  "electronics":"Essentials","charger":"Essentials","phone charger":"Essentials",
  "mechanic":"Service","barber":"Service","salon":"Service","tailor":"Service","clinic":"Service",
};
const SYNONYMS: Record<string,string[]> = {
  "paracetamol": ["acetaminophen","panadol","tylenol","emzor paracetamol"],
  "rice": ["jollof rice","basmati","golden penny rice","parboiled rice"],
  "milk": ["peak milk","three crowns","dano"],
  "charger": ["phone charger","power adapter","usb-c charger","fast charge"],
  "indomie": ["noodles","instant noodles","spaghetti"],
};

function parseWholeNaira(value: string): number | null {
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value)) return null;
  const minor = parseMajorAmountToMinor(value.replaceAll(",", ""), 2);
  if (minor === null || minor % 100n !== 0n) return null;
  const major = minor / 100n;
  return major <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(major) : null;
}

export function parseNaturalQuery(input: string): ParsedQuery {
  const original = input;
  const text = input.toLowerCase().trim();
  const result: ParsedQuery = { original, q: "", intent:"search", confidence: 0.8 };
  let invalidPriceMention = false;

  // Intent detection
  if (text.includes("compare")) result.intent = "compare";
  if (text.includes("reserve") || text.includes("book")) result.intent = "reserve";
  if (text.includes("where is") || text.includes("directions")) result.intent = "directions";

  // Area
  for (const a of ABUJA_AREAS) {
    if (text.includes(a)) { result.area = a.split(" ").map(s=>s.charAt(0).toUpperCase()+s.slice(1)).join(" "); break; }
  }
  if (text.includes("wuse 2")) result.area = "Wuse";
  if (text.includes("near me") || text.includes("nearby") || text.includes("close to me")) {
    result.distanceKm = result.distanceKm || 3;
  }

  // Distance
  const distMatch = text.match(/within\s+(\d+)\s*(km|kilometre|kilometer)/);
  if (distMatch) result.distanceKm = parseInt(distMatch[1]);
  const dist2 = text.match(/(\d+)\s*(km|kilometres)\s+away/);
  if (dist2) result.distanceKm = parseInt(dist2[1]);

  // Price filters are whole-Naira language inputs; explicit form/API filters support exact minor precision.
  const underMatch = text.match(/under\s+(?:₦|naira|ngn)?\s*([\d,]+(?:\.\d+)?)/);
  if (underMatch) {
    const amount = parseWholeNaira(underMatch[1]);
    if (amount === null) invalidPriceMention = true;
    else result.maxPrice = amount;
  }
  const budgetMatch = text.match(/budget\s*([\d,]+(?:\.\d+)?)/);
  if (budgetMatch) {
    const amount = parseWholeNaira(budgetMatch[1]);
    if (amount === null) invalidPriceMention = true;
    else result.maxPrice = amount;
  }
  const priceRange = text.match(/(?:₦)?\s*([\d,]+(?:\.\d+)?)\s*-\s*(?:₦)?\s*([\d,]+(?:\.\d+)?)/);
  if (priceRange) {
    const min = parseWholeNaira(priceRange[1]);
    const max = parseWholeNaira(priceRange[2]);
    if (min === null || max === null) invalidPriceMention = true;
    else { result.minPrice = min; result.maxPrice = max; }
  }

  // Filters
  if (text.includes("open now") || text.includes("open today")) result.openNow = true;
  if (text.includes("in stock") || text.includes("available now")) result.inStock = true;
  if (text.includes("pickup") || text.includes("collect") || text.includes("pick up")) result.pickup = true;
  if (text.includes("delivery") || text.includes("deliver")) result.delivery = true;
  if (text.includes("verified")) result.verified = true;

  // Time window
  const timeMatch = text.match(/before\s+(\d+\s*(am|pm))/);
  if (timeMatch) result.timeWindow = timeMatch[1];
  if (text.includes("tomorrow")) result.timeWindow = "tomorrow";
  if (text.includes("this afternoon")) result.timeWindow = "this afternoon";

  // Category
  for (const [alias, cat] of Object.entries(CATEGORY_ALIASES)) {
    if (text.includes(alias)) { result.category = cat; break; }
  }

  // Extract q: remove stopwords and known filters
  let q = text;
  // strip known phrases
  const stripPhrases = [
    "find","where can i buy","show me","i need","find a","near me","nearby","open now","within","under","budget","delivery","pickup","verified","in stock","available","for pickup","before","today","tomorrow","please","compare the prices of","find a similar product","show businesses that can deliver"
  ];
  for (const p of stripPhrases) q = q.replace(p, " ");
  // remove price / distance / area fragments so q is just the product phrase
  q = q.replace(/₦[\d,]+/g," ").replace(/\d+\s*km/g," ").replace(/\d+\s*naira/g," ");
  if (result.maxPrice) q = q.replace(new RegExp(String(result.maxPrice).replace(/\B(?=(\d{3})+(?!\d))/g, ","), "g"), " ").replace(new RegExp("\\b" + result.maxPrice + "\\b"), " ");
  if (result.minPrice) q = q.replace(new RegExp("\\b" + result.minPrice + "\\b"), " ");
  if (result.area) q = q.replace(new RegExp("\\b" + result.area.toLowerCase() + "\\b", "g"), " ");
  q = q.replace(/\bin\b/g, " ").replace(/[?,.!]/g, " ");
  q = q.replace(/\s+/g," ").trim();
  // handle brand
  const brandMatch = q.match(/\b(emzor|gsk|peak|golden penny|indomie|oraimo|dettol|peak|coca-cola)\b/);
  if (brandMatch) { result.brand = brandMatch[1]; }

  result.q = q || text.split(" ").slice(0,4).join(" ");
  if (!result.q) result.q = original;

  // confidence heuristics
  if (!q || q.length < 2) result.confidence = 0.5;
  if (text.length < 5) result.confidence = 0.4;
  if (result.clarifications===undefined) result.clarifications = [];
  if (invalidPriceMention) {
    result.priceFilterInvalid = true;
    result.clarifications.push("The price filter was not applied because its amount could not be read safely. Use a whole-naira amount with correctly grouped digits.");
  }
  if (!result.q && !result.category) result.clarifications.push("What product or service do you need?");
  if (result.intent==="search" && !result.q) result.clarifications.push("Could you specify the product name?");

  return result;
}

export function expandQueryWithSynonyms(q: string): string[] {
  const lower = q.toLowerCase();
  const expansions = [q];
  for (const [key, syns] of Object.entries(SYNONYMS)) {
    if (lower.includes(key)) {
      expansions.push(...syns);
    }
  }
  // add spelling variations: simple double-letter handling
  return [...new Set(expansions)];
}

export function normalizeQuery(q: string): string {
  return q.toLowerCase().trim().replace(/\s+/g," ");
}

/**
 * Precios extraídos de "La Mia Pitza Menu 2.pdf" (córdobas / precios del menú físico).
 * Clave: código de receta PZ-xxx de la plantilla Excel.
 */
export const RECIPE_CODE_PRICES: Record<string, number> = {
  'PZ-001': 565, // Pitza Pepperoni  → PDF: Pepperoni
  'PZ-002': 510, // Cheese Bar Pie
  'PZ-003': 550, // Capresse
  'PZ-004': 530, // La Cotto
  'PZ-005': 530, // La Extra
  'PZ-006': 685, // La Bianco
  'PZ-007': 570, // Dulce Fiery
  'PZ-008': 590, // Maui Pitza
  'PZ-009': 595, // Basilea
  'PZ-010': 560, // Della Nonna
  'PZ-011': 580, // 4 Quesos y Hongos  → PDF: 4 Quesos & Hongos
  'PZ-012': 590, // La Sussana         → PDF: La Sussanna
  'PZ-013': 585, // La Pedronni        → PDF: La Pedroni
};

/** Precios por nombre normalizado (para ítems sin código PZ en descripción). */
export const MENU_NAME_PRICES: Record<string, number> = {
  'cheese bar pie': 510,
  capresse: 550,
  pepperoni: 565,
  'pitza pepperoni': 565,
  'la cotto': 530,
  'la extra': 530,
  'la bianco': 685,
  '4 quesos y hongos': 580,
  '4 quesos & hongos': 580,
  'della nonna': 560,
  'dulce fiery': 570,
  'maui pitza': 590,
  'la mia pitza': 675,
  basilea: 595,
  'alla vodka': 575,
  'la reina': 560,
  'la sussana': 590,
  'la sussanna': 590,
  'la pedronni': 585,
  'la pedroni': 585,
  focaccia: 260,
};

export function normalizeMenuKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'y')
    .replace(/\s+/g, ' ');
}

export function extractRecipeCode(description: string | null | undefined): string | null {
  if (!description) return null;
  const match = description.match(/Código receta:\s*(PZ-\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

export function resolveMenuPrice(name: string, description?: string | null): number | null {
  const code = extractRecipeCode(description);
  if (code && RECIPE_CODE_PRICES[code] != null) return RECIPE_CODE_PRICES[code];

  const key = normalizeMenuKey(name);
  if (MENU_NAME_PRICES[key] != null) return MENU_NAME_PRICES[key];

  return null;
}

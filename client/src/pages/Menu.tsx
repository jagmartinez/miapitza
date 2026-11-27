import { useState, useEffect, useCallback } from 'react';
import { branchPricingAPI, menuAPI, productsAPI, categoriesAPI, branchesAPI, unitsAPI, menuBrandsAPI, modifiersAPI, reportsAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { hasAnyRole } from '../utils/authz';
import {
  AppSelect, Badge, Button, Checkbox, DataTable, EmptyState, Field, FormGrid, FormSection, FullScreenModal, IconButton, Input,
  LoadErrorState, PageContent, PageHeader, SegmentedControl, Skeleton, TableToolbar, Tabs, Textarea, formatNumber, formatPercent,
  type Column, type Opt, type Tone, formatQty} from '@/ui';
import {
  Plus, Utensils, Trash2,
  ImagePlus, Pencil, Save,
  SlidersHorizontal, Package, Eye, LayoutGrid, Table2
} from 'lucide-react';
import { useViewMode, type ViewMode } from '../hooks/useViewMode';
import { formatLocalDateInput } from '../utils/dateInput';
import type { Branch, MenuItem, MenuBrand, MenuRecipe, Product, ProductAllowedUnit, UnitOfMeasure } from '../types';
import {
  calculateMenuRecipeLineCost,
  type EditableMenuRecipe,
  validateMenuRecipes,
} from '../utils/menuRecipe';

type MenuStatusFilter = 'active' | 'inactive' | 'all';
const STATUS_TABS: { id: MenuStatusFilter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'active', label: 'Activos' },
  { id: 'inactive', label: 'Inactivos' },
];
const INVENTORY_EFFECT_OPTIONS: Opt<ModifierInventoryEffect>[] = [
  { value: 'ADD', label: 'Agrega consumo (extra)' },
  { value: 'REMOVE', label: 'Quita ingrediente de la receta ("Sin …")' },
];
import MenuItemCard from '../components/MenuItemCard';
import { useCurrency } from '../hooks/useCurrency';
import { useGoals } from '../hooks/useGoals';
import ImageViewer from '../components/ImageViewer';
import { isCategoryVisibleInMenu } from '../utils/categoryVisibility';
import { effectiveUnitCost } from '../utils/productCost';
import {
  MENU_CLASS_HINT, MENU_CLASS_LABEL, classifyMenu,
  type MenuClass, type MenuSalesRow,
} from './menuEngineering';
import s from './Menu.module.css';
import './Menu.css';
import { getApiErrorMessage } from '../utils/apiError';

// The menu list flags items without any recipe line (legacy DIRECT rows): they
// are still sellable but never deduct stock until a recipe is added.
function lacksRecipe(item: MenuItem): boolean {
  return (item as MenuItem & { missingRecipe?: boolean }).missingRecipe === true;
}

interface CategoryRow {
  id: number;
  name: string;
  active?: boolean;
  showInMenu?: boolean;
  showInInventory?: boolean;
}

interface BranchPriceRow {
  branchId: number;
  price: number | string;
}

interface MenuImageRecord {
  id: number;
  imageUrl: string;
}

type ItemClass = MenuClass | 'SIN_RECETA';

const CLASS_TONE: Record<ItemClass, Tone> = {
  ESTRELLA: 'success',
  CABALLO: 'primary',
  PUZZLE: 'warning',
  PERRO: 'danger',
  SIN_VENTAS: 'neutral',
  SIN_COSTO: 'neutral',
  SIN_RECETA: 'danger',
};

/** Valor de un input numérico (sin separador de miles para que siga siendo un número válido). */
const amountDraft = (value: unknown): string => Number(value).toFixed(2);

interface EngineeringApiRow {
  menuItemId: number;
  price: number | string;
  cost: number | string;
  margin: number | string;
  qtySold: number | string;
  revenue: number | string;
}

// Modifier inventory link: a modifier can optionally consume `consumeQuantity`
// (in `unitId`) of `productId` from inventory when selected during a sale.
interface ModifierRow {
  id: number;
  name: string;
  price: number | string;
  active: boolean;
  productId?: number | null;
  consumeQuantity?: number | string | null;
  unitId?: number | null;
  /** ADD consumes the product; REMOVE ("Sin X") reduces that recipe line of the dish. */
  inventoryEffect?: ModifierInventoryEffect | null;
  product?: { id: number; name: string } | null;
  unit?: { id: number; name: string; abbreviation: string } | null;
}

type ModifierInventoryEffect = 'ADD' | 'REMOVE';

interface ModifierGroupRow {
  id: number;
  name: string;
  description?: string | null;
  modifiers: ModifierRow[];
}

// Products eligible to be consumed by a modifier (insumos / empaques / intermedios).
const MODIFIER_PRODUCT_TYPES: Product['type'][] = ['INGREDIENT', 'BOTH', 'INTERMEDIATE', 'PACKAGING'];
const RECIPE_PRODUCT_TYPES: Product['type'][] = ['INGREDIENT', 'BOTH', 'INTERMEDIATE', 'PACKAGING'];

interface RecipeRow { ing: EditableMenuRecipe; index: number }
interface DetailComponentRow { component: MenuRecipe; index: number }
interface PriceRow { branch: Branch; existing?: BranchPriceRow }

function errMsg(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const message = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

type MenuItemDetail = Omit<MenuItem, 'recipes'> & {
  recipes: MenuRecipe[];
  totalCost?: number | string;
  margin?: number | string;
  branch?: { id: number; name: string; code?: string | null } | null;
};

function fallbackProductUnit(product?: Pick<Product, 'unit'> & Partial<Pick<Product, 'baseUnitId'>>): ProductAllowedUnit[] {
  if (!product?.unit) return [];
  return [{
    unitId: product.baseUnitId ?? 0,
    abbreviation: product.unit,
    name: product.unit,
    conversionFactor: 1,
    isBase: true,
    isDefault: true,
  }];
}

export default function Menu() {
  const { user } = useAuth();
  const { formatMoney, symbol } = useCurrency();
  const goals = useGoals(null);
  const { confirm } = useConfirmDialog();
  const { error: showError, warning: showWarning, success: showSuccess } = useAppToast();
  /** Backend: menu/recipe/image mutations require SUPERADMIN | ADMIN | CHEF. */
  const canMutateMenu = hasAnyRole(user, ['SUPERADMIN', 'ADMIN', 'CHEF']);
  /** Backend: branch price overrides via /advanced/pricing require SUPERADMIN | ADMIN */
  const canSetBranchPrices = hasAnyRole(user, ['SUPERADMIN', 'ADMIN']);
  /** GET /reports/menu-engineering requires SUPERADMIN | ADMIN: costs and sales stay hidden for other roles. */
  const canSeeCosts = hasAnyRole(user, ['SUPERADMIN', 'ADMIN']);

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyMissingRecipe, setOnlyMissingRecipe] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [brands, setBrands] = useState<MenuBrand[]>([]);
  const [selectedBrand, setSelectedBrand] = useState<string>('all');
  // Inactive dishes (e.g. imported without price) must stay reachable so they
  // can be priced and activated; the default view keeps showing active ones.
  const [selectedStatus, setSelectedStatus] = useState<MenuStatusFilter>('active');
  const [selectedClass, setSelectedClass] = useState<ItemClass | 'all'>('all');
  const [engineering, setEngineering] = useState<MenuSalesRow[] | null>(null);
  const [engineeringError, setEngineeringError] = useState<string | null>(null);
  const { viewMode, setViewMode } = useViewMode('menu', 'table');

  // Sidebar State
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [viewingItem, setViewingItem] = useState<MenuItemDetail | null>(null);
  const [viewingBranchPrices, setViewingBranchPrices] = useState<BranchPriceRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    categoryId: '',
    branchId: '',
    brandId: '',
    active: true
  });

  const [recipe, setRecipe] = useState<EditableMenuRecipe[]>([]);
  const [recipeUnitsByProduct, setRecipeUnitsByProduct] = useState<Record<number, ProductAllowedUnit[]>>({});
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [selectedIngredientUnit, setSelectedIngredientUnit] = useState<string>('');
  const [ingredientUnits, setIngredientUnits] = useState<ProductAllowedUnit[]>([]);
  const [quantity, setQuantity] = useState<string>('');
  const [images, setImages] = useState<string[]>([]);
  const [originalImages, setOriginalImages] = useState<MenuImageRecord[]>([]);
  const [branchPricing, setBranchPricing] = useState<BranchPriceRow[]>([]);
  const [branchPriceDrafts, setBranchPriceDrafts] = useState<Record<number, string>>({});
  const [savingBranchPriceId, setSavingBranchPriceId] = useState<number | null>(null);

  // Image Viewer State
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [viewerImages, setViewerImages] = useState<string[]>([]);
  const [viewerInitialIndex, setViewerInitialIndex] = useState(0);

  // Modal Tab State
  const [activeTab, setActiveTab] = useState<'info' | 'recipe' | 'gallery' | 'pricing'>('info');
  const [saving, setSaving] = useState(false);

  // ── Modifiers admin (groups + modifiers with inventory link) ──
  const [isModifierModalOpen, setIsModifierModalOpen] = useState(false);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroupRow[]>([]);
  const [modifierProducts, setModifierProducts] = useState<Product[]>([]);
  const [units, setUnits] = useState<UnitOfMeasure[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [editingModifierId, setEditingModifierId] = useState<number | null>(null);
  const [modifierForm, setModifierForm] = useState({
    name: '',
    extraPrice: '',
    productId: '',
    consumeQuantity: '',
    unitId: '',
    inventoryEffect: 'ADD' as ModifierInventoryEffect
  });
  const [savingModifier, setSavingModifier] = useState(false);

  const calculateIngredientLineCost = calculateMenuRecipeLineCost;

  const loadData = useCallback(async () => {
    try {
      const [menuRes, productsRes, categoriesRes, branchesRes, brandsRes] = await Promise.all([
        menuAPI.getAll(),
        productsAPI.getAll({ active: true, limit: 500 }),
        categoriesAPI.getAll(),
        branchesAPI.getAll(),
        menuBrandsAPI.getAll()
      ]);
      setMenuItems(menuRes.data.data);
      setBranches(branchesRes.data.data || []);
      setBrands(brandsRes.data.data || []);
      setProducts((productsRes.data.data || []).filter((p: Product) => RECIPE_PRODUCT_TYPES.includes(p.type)));
      setCategories(categoriesRes.data.data);
      setLoadError(null);
    } catch (error) {
      console.error('Error loading data:', error);
      setLoadError('No se pudo cargar el menú y sus ingredientes.');
      showError(errMsg(error, 'No se pudo cargar el menú y sus ingredientes'));
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  /** Costo estándar, margen y unidades vendidas de los últimos 30 días (solo lectura). */
  const loadEngineering = useCallback(async () => {
    if (!canSeeCosts) return;
    setEngineeringError(null);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
      const params: Record<string, string> = { dateFrom: formatLocalDateInput(from), dateTo: formatLocalDateInput(to), includeUnsold: '1' };
      if (selectedBranch !== 'all') params.branchId = selectedBranch;
      const res = await reportsAPI.getMenuEngineering(params);
      const items = (res.data.data?.items ?? []) as EngineeringApiRow[];
      setEngineering(items.map((row) => ({
        menuItemId: Number(row.menuItemId),
        price: Number(row.price),
        cost: Number(row.cost),
        margin: Number(row.margin),
        qtySold: Number(row.qtySold),
        revenue: Number(row.revenue),
      })));
    } catch (error) {
      console.error('Error loading menu engineering:', error);
      setEngineering(null);
      setEngineeringError(errMsg(error, 'No se pudieron cargar los costos y ventas de 30 días.'));
    }
  }, [canSeeCosts, selectedBranch]);

  useEffect(() => {
    void loadEngineering();
  }, [loadEngineering]);

  const resetModifierForm = () => {
    setEditingModifierId(null);
    setModifierForm({ name: '', extraPrice: '', productId: '', consumeQuantity: '', unitId: '', inventoryEffect: 'ADD' });
  };

  const loadModifierData = async () => {
    try {
      const [groupsRes, productsRes, unitsRes] = await Promise.all([
        modifiersAPI.getAllGroups(),
        productsAPI.getAll({ active: true }),
        unitsAPI.getAll()
      ]);
      const groups: ModifierGroupRow[] = groupsRes.data.data || [];
      setModifierGroups(groups);
      setModifierProducts(
        (productsRes.data.data || []).filter((p: Product) => MODIFIER_PRODUCT_TYPES.includes(p.type))
      );
      setUnits((unitsRes.data.data || []).filter((u: UnitOfMeasure) => u.active));
      // Keep the current selection if it still exists, otherwise pick the first group.
      setSelectedGroupId((prev) =>
        prev && groups.some((g) => g.id === prev) ? prev : (groups[0]?.id ?? null)
      );
    } catch (error) {
      console.error('Error loading modifiers:', error);
      showError(getApiErrorMessage(error, 'No se pudieron cargar los modificadores'));
    }
  };

  const openModifierModal = async () => {
    resetModifierForm();
    setNewGroupName('');
    setIsModifierModalOpen(true);
    await loadModifierData();
  };

  const handleCreateGroup = async () => {
    const name = newGroupName.trim();
    if (!name) return;
    try {
      const res = await modifiersAPI.createGroup({ name });
      setNewGroupName('');
      await loadModifierData();
      const createdId = res.data?.data?.id;
      if (createdId) setSelectedGroupId(createdId);
      showSuccess('Grupo de modificadores creado');
    } catch (error) {
      console.error('Error creating modifier group:', error);
      showError(getApiErrorMessage(error, 'No se pudo crear el grupo'));
    }
  };

  const handleEditModifier = (modifier: ModifierRow) => {
    setEditingModifierId(modifier.id);
    setModifierForm({
      name: modifier.name,
      extraPrice: modifier.price != null ? String(modifier.price) : '',
      productId: modifier.productId != null ? String(modifier.productId) : '',
      consumeQuantity: modifier.consumeQuantity != null ? String(modifier.consumeQuantity) : '',
      unitId: modifier.unitId != null ? String(modifier.unitId) : '',
      inventoryEffect: modifier.inventoryEffect === 'REMOVE' ? 'REMOVE' : 'ADD'
    });
  };

  const handleSaveModifier = async () => {
    const name = modifierForm.name.trim();
    if (!name) {
      showWarning('El nombre del modificador es obligatorio');
      return;
    }
    if (!editingModifierId && !selectedGroupId) {
      showWarning('Selecciona o crea un grupo primero');
      return;
    }
    // A modifier links inventory only when a product is chosen; quantity is then required.
    const hasProduct = modifierForm.productId !== '';
    const isRemoval = modifierForm.inventoryEffect === 'REMOVE';
    // "Sin X": the product is required (it is the recipe line removed); an
    // empty quantity removes the whole line.
    if (isRemoval && !hasProduct) {
      showWarning('Selecciona el ingrediente de la receta que este modificador quita');
      return;
    }
    const hasQuantity = modifierForm.consumeQuantity !== '';
    if (hasProduct && (isRemoval ? hasQuantity && Number(modifierForm.consumeQuantity) <= 0 : !hasQuantity || Number(modifierForm.consumeQuantity) <= 0)) {
      showWarning(isRemoval ? 'La cantidad a quitar debe ser mayor a 0 (o déjala vacía para quitar todo)' : 'Indica una cantidad a consumir mayor a 0');
      return;
    }
    if (isRemoval && !hasQuantity && modifierForm.unitId !== '') {
      showWarning('Una unidad requiere una cantidad a quitar');
      return;
    }

    const payload: Record<string, unknown> = {
      name,
      extraPrice: modifierForm.extraPrice === '' ? 0 : Number(modifierForm.extraPrice),
      // Send explicit null to unlink when no product is selected.
      productId: hasProduct ? Number(modifierForm.productId) : null,
      consumeQuantity: hasProduct && hasQuantity ? Number(modifierForm.consumeQuantity) : null,
      unitId: hasProduct && modifierForm.unitId !== '' ? Number(modifierForm.unitId) : null,
      inventoryEffect: modifierForm.inventoryEffect
    };

    setSavingModifier(true);
    try {
      if (editingModifierId) {
        await modifiersAPI.updateModifier(editingModifierId, payload);
        showSuccess('Modificador actualizado');
      } else {
        await modifiersAPI.createModifier({ ...payload, groupId: selectedGroupId });
        showSuccess('Modificador creado');
      }
      resetModifierForm();
      await loadModifierData();
    } catch (error) {
      console.error('Error saving modifier:', error);
      showError(getApiErrorMessage(error, 'No se pudo guardar el modificador'));
    } finally {
      setSavingModifier(false);
    }
  };

  const handleDeleteModifier = async (modifier: ModifierRow) => {
    const ok = await confirm(`¿Eliminar el modificador "${modifier.name}"?`, {
      title: 'Eliminar modificador',
      confirmText: 'Eliminar',
      variant: 'danger'
    });
    if (!ok) return;
    try {
      await modifiersAPI.deleteModifier(modifier.id);
      if (editingModifierId === modifier.id) resetModifierForm();
      await loadModifierData();
      showSuccess('Modificador eliminado');
    } catch (error) {
      console.error('Error deleting modifier:', error);
      showError(getApiErrorMessage(error, 'No se pudo eliminar el modificador'));
    }
  };

  const handleOpenSidebar = async (item?: MenuItem) => {
    if (item) {
      setEditingItem(item);
      setFormData({
        name: item.name,
        description: item.description || '',
        price: item.price.toString(),
        categoryId: item.categoryId.toString(),
        branchId: item.branchId?.toString() || '',
        brandId: item.brandId?.toString() || '',
        active: item.active !== false
      });
      // Never leave data from the previously-opened item in the editor while
      // this item's imported recipe is being loaded.
      setRecipe([]);
      setRecipeUnitsByProduct({});
      setImages([]);
      setOriginalImages([]);
      setBranchPricing([]);
      setBranchPriceDrafts({});

      try {
        const [recipesRes, imagesRes, pricingRes] = await Promise.all([
          menuAPI.getRecipes(item.id),
          menuAPI.getImages(item.id),
          branchPricingAPI.getMenuItemMatrix(item.id),
        ]);

        const recipeRows: MenuRecipe[] = recipesRes.data.data || [];
        const uniqueProductIds = Array.from(new Set(recipeRows.map((r) => r.product.id)));
        const productUnitsMap = new Map<number, ProductAllowedUnit[]>();

        await Promise.all(uniqueProductIds.map(async (productId) => {
          const catalogProduct = products.find((product) => product.id === productId)
            ?? recipeRows.find((row) => row.product.id === productId)?.product;
          try {
            const unitsRes = await unitsAPI.getProductUnits(productId);
            const allowedUnits: ProductAllowedUnit[] = unitsRes.data.data || [];
            productUnitsMap.set(productId, allowedUnits.length > 0 ? allowedUnits : fallbackProductUnit(catalogProduct));
          } catch {
            productUnitsMap.set(productId, fallbackProductUnit(catalogProduct));
          }
        }));

        const loadedRecipes: EditableMenuRecipe[] = recipeRows.map((r) => {
          const allowedUnits = productUnitsMap.get(r.product.id) || [];
          const unitFromId = r.unitId == null
            ? undefined
            : allowedUnits.find((unit) => unit.unitId === r.unitId)?.abbreviation;
          const recipeUnit = r.unit || r.unitOfMeasure?.abbreviation || unitFromId || r.product.unit;
          const matchedUnit = allowedUnits.find(
            (u) => u.abbreviation.toLowerCase() === String(recipeUnit).toLowerCase()
          );
          const catalogProduct = products.find((product) => product.id === r.product.id);
          return {
            id: r.id,
            productId: r.product.id,
            productName: r.product.name,
            quantity: Number(r.quantity),
            unit: recipeUnit,
            cost: effectiveUnitCost(
              catalogProduct?.currentAverageCost ?? r.product.currentAverageCost,
              catalogProduct?.cost ?? r.product.cost,
            ),
            conversionFactor: Number(matchedUnit?.conversionFactor ?? 0),
            unitConfigured: Boolean(matchedUnit),
          };
        });

        const loadedImageRecords: MenuImageRecord[] = imagesRes.data.data || [];
        const loadedImages = loadedImageRecords.map((img) => img.imageUrl);

        setRecipe(loadedRecipes);
        setRecipeUnitsByProduct(Object.fromEntries(productUnitsMap));
        setImages(loadedImages);
        setOriginalImages(loadedImageRecords);
        setBranchPricing(pricingRes.data.data.branchPrices || []);
        setBranchPriceDrafts(
          (pricingRes.data.data.branchPrices || []).reduce((acc: Record<number, string>, priceRow: BranchPriceRow) => {
            acc[priceRow.branchId] = amountDraft(priceRow.price);
            return acc;
          }, {})
        );
      } catch (error) {
        console.error('Error loading details:', error);
        showError(errMsg(error, 'No se pudo cargar la receta del plato'));
        return;
      }
    } else {
      setEditingItem(null);
      setFormData({ name: '', description: '', price: '', categoryId: '', branchId: '', brandId: '', active: true });
      setRecipe([]);
      setRecipeUnitsByProduct({});
      setImages([]);
      setOriginalImages([]);
      setBranchPricing([]);
      setBranchPriceDrafts({});
    }
    setIsSidebarOpen(true);
  };

  const handleOpenDetail = async (item: MenuItem) => {
    setDetailOpen(true);
    setViewingItem(null);
    setViewingBranchPrices([]);
    setDetailError(null);
    setDetailLoading(true);

    try {
      const detailResponse = await menuAPI.getById(item.id);
      const [imagesResult, pricingResult] = await Promise.allSettled([
        menuAPI.getImages(item.id),
        canSetBranchPrices
          ? branchPricingAPI.getMenuItemMatrix(item.id)
          : Promise.resolve(null),
      ]);

      const detail = detailResponse.data.data as MenuItemDetail;
      const loadedImages = imagesResult.status === 'fulfilled'
        ? ((imagesResult.value.data.data || []) as MenuImageRecord[])
        : (item.images || []);
      const loadedBranchPrices = pricingResult.status === 'fulfilled' && pricingResult.value
        ? ((pricingResult.value.data.data?.branchPrices || []) as BranchPriceRow[])
        : [];

      setViewingItem({
        ...detail,
        brand: detail.brand ?? item.brand,
        category: detail.category ?? item.category,
        images: loadedImages,
      });
      setViewingBranchPrices(loadedBranchPrices);
    } catch (error) {
      console.error('Error loading menu item detail:', error);
      setDetailError(errMsg(error, 'No se pudo cargar el detalle del plato'));
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSaveBranchPrice = async (branchId: number) => {
    if (!canSetBranchPrices) return;
    if (!editingItem) return;

    const nextPrice = parseFloat(branchPriceDrafts[branchId] || '');
    if (!Number.isFinite(nextPrice) || nextPrice <= 0) {
      showWarning('Ingresa un precio válido para la sucursal.');
      return;
    }

    try {
      setSavingBranchPriceId(branchId);
      await branchPricingAPI.setBranchPrice(editingItem.id, branchId, nextPrice);
      const pricingRes = await branchPricingAPI.getMenuItemMatrix(editingItem.id);
      setBranchPricing(pricingRes.data.data.branchPrices || []);
      setBranchPriceDrafts(
        (pricingRes.data.data.branchPrices || []).reduce((acc: Record<number, string>, priceRow: BranchPriceRow) => {
          acc[priceRow.branchId] = amountDraft(priceRow.price);
          return acc;
        }, {})
      );
    } catch (error) {
      console.error('Error saving branch price:', error);
      showError(getApiErrorMessage(error, 'No se pudo guardar el precio por sucursal'));
    } finally {
      setSavingBranchPriceId(null);
    }
  };

  const handleIngredientProductChange = useCallback(async (productId: string) => {
    setSelectedProductId(productId);
    if (!productId) {
      setIngredientUnits([]);
      setSelectedIngredientUnit('');
      return;
    }
    const product = products.find(p => p.id === parseInt(productId));
    try {
      const res = await unitsAPI.getProductUnits(Number(productId));
      const configuredUnits: ProductAllowedUnit[] = res.data.data || [];
      const units = configuredUnits.length > 0 ? configuredUnits : fallbackProductUnit(product);
      setRecipeUnitsByProduct((previous) => ({ ...previous, [Number(productId)]: units }));
      if (units.length > 0) {
        setIngredientUnits(units);
        const defaultUnit = units.find(u => u.isBase) || units.find(u => u.isDefault) || units[0];
        setSelectedIngredientUnit(defaultUnit?.abbreviation || product?.unit || '');
      } else {
        const baseUnit = product?.unit || 'unidad';
        setIngredientUnits([{ unitId: 0, abbreviation: baseUnit, name: baseUnit, conversionFactor: 1, isBase: true, isDefault: true }]);
        setSelectedIngredientUnit(baseUnit);
      }
    } catch {
      const units = fallbackProductUnit(product);
      setRecipeUnitsByProduct((previous) => ({ ...previous, [Number(productId)]: units }));
      setIngredientUnits(units);
      setSelectedIngredientUnit(units[0]?.abbreviation || '');
    }
  }, [products]);

  const addIngredient = () => {
    if (!selectedProductId) {
      showWarning('Selecciona un ingrediente');
      return;
    }

    const product = products.find(p => p.id === parseInt(selectedProductId));
    if (!product) return;
    const parsedQuantity = Number(quantity);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      showWarning('La cantidad del ingrediente debe ser mayor a 0');
      return;
    }
    if (recipe.some((ingredient) => ingredient.productId === product.id)) {
      showWarning(`El ingrediente "${product.name}" ya está en la receta`);
      return;
    }
    const selectedUnit = selectedIngredientUnit || product.unit;
    const matchedUnit = ingredientUnits.find(
      (unit) => unit.abbreviation.toLowerCase() === selectedUnit.toLowerCase()
    );
    if (!matchedUnit) {
      showWarning(`Selecciona una unidad configurada para "${product.name}"`);
      return;
    }

    const newIngredient: EditableMenuRecipe = {
      productId: product.id,
      productName: product.name,
      quantity: parsedQuantity,
      unit: selectedUnit,
      cost: effectiveUnitCost(product.currentAverageCost, product.cost),
      conversionFactor: Number(matchedUnit.conversionFactor),
      unitConfigured: true,
    };

    setRecipe((previous) => [...previous, newIngredient]);
    setSelectedProductId('');
    setSelectedIngredientUnit('');
    setIngredientUnits([]);
    setQuantity('');
  };

  const removeIngredient = (index: number) => {
    setRecipe((previous) => previous.filter((_, i) => i !== index));
  };

  const updateIngredientQuantity = (index: number, nextQuantity: string) => {
    setRecipe((previous) => previous.map((ingredient, ingredientIndex) =>
      ingredientIndex === index ? { ...ingredient, quantity: nextQuantity } : ingredient
    ));
  };

  const updateIngredientUnit = (index: number, nextUnit: string) => {
    setRecipe((previous) => previous.map((ingredient, ingredientIndex) => {
      if (ingredientIndex !== index) return ingredient;
      const matchedUnit = (recipeUnitsByProduct[ingredient.productId] || []).find(
        (unit) => unit.abbreviation.toLowerCase() === nextUnit.toLowerCase()
      );
      return {
        ...ingredient,
        unit: nextUnit,
        conversionFactor: Number(matchedUnit?.conversionFactor ?? 0),
        unitConfigured: Boolean(matchedUnit),
      };
    }));
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setImages(prev => [...prev, event.target!.result as string]);
        }
      };
      reader.readAsDataURL(file);
    });

    // Reset input to allow re-uploading the same file if needed
    e.target.value = '';
  };

  const removeImage = (index: number) => {
    setImages(images.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canMutateMenu) return;

    const price = Number(formData.price);
    if (!formData.name.trim()) {
      showWarning('El nombre del plato es obligatorio');
      return;
    }
    if (!formData.categoryId) {
      showWarning('Selecciona una categoría');
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      showWarning('Ingresa un precio válido');
      return;
    }
    const recipeValidationError = validateMenuRecipes(recipe, { requireAtLeastOne: true });
    if (recipeValidationError) {
      showWarning(recipeValidationError);
      setActiveTab('recipe');
      return;
    }

    setSaving(true);
    try {
      const menuData = {
        name: formData.name.trim(),
        description: formData.description || undefined,
        price,
        categoryId: parseInt(formData.categoryId),
        branchId: formData.branchId ? parseInt(formData.branchId) : null,
        brandId: formData.brandId ? parseInt(formData.brandId) : null,
        type: 'PREPARED',
        active: formData.active
      };

      let menuItemId: number;
      if (editingItem) {
        menuItemId = editingItem.id;
        await menuAPI.replaceRecipes(menuItemId, recipe.map((ingredient) => ({
          productId: ingredient.productId,
          quantity: Number(ingredient.quantity),
          unit: ingredient.unit.trim(),
        })), menuData);

        const retainedImageUrls = new Set(images);
        const originalImageUrls = new Set(originalImages.map((image) => image.imageUrl));
        const removedImages = originalImages.filter((image) => !retainedImageUrls.has(image.imageUrl));
        const addedImages = images.filter((imageUrl) => !originalImageUrls.has(imageUrl));
        await Promise.all(removedImages.map((image) => menuAPI.deleteImage(image.id)));
        await Promise.all(addedImages.map((imageUrl) => menuAPI.addImage(menuItemId, imageUrl)));
      } else {
        const response = await menuAPI.create(menuData);
        menuItemId = response.data.data.id;
        await menuAPI.replaceRecipes(menuItemId, recipe.map((ingredient) => ({
          productId: ingredient.productId,
          quantity: Number(ingredient.quantity),
          unit: ingredient.unit.trim(),
        })), menuData);
        await Promise.all(images.map((imageUrl) => menuAPI.addImage(menuItemId, imageUrl)));
      }

      setIsSidebarOpen(false);
      await loadData();
      showSuccess(editingItem ? 'Plato y receta actualizados' : 'Plato y receta creados');
    } catch (error: unknown) {
      console.error('Error saving menu item:', error);
      const message = errMsg(error, 'Error al guardar el plato y su receta');

      // Images and item metadata still use separate requests. Recipe replacement
      // itself is atomic; force the next open to read the authoritative result if
      // a later request fails.
      setIsSidebarOpen(false);
      setEditingItem(null);
      setRecipe([]);
      setRecipeUnitsByProduct({});
      setSelectedProductId('');
      setSelectedIngredientUnit('');
      setIngredientUnits([]);
      setQuantity('');
      setImages([]);
      setOriginalImages([]);
      setActiveTab('info');
      await loadData();
      showError(`${message}. El catálogo se recargó; vuelve a abrir el plato antes de reintentar.`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!canMutateMenu) return;
    if (!(await confirm('¿Eliminar este plato?', { title: 'Confirmar acción' }))) return;
    try {
      await menuAPI.delete(id);
      loadData();
    } catch (error) {
      showError(getApiErrorMessage(error, 'Error al eliminar el plato'));
    }
  };

  // Filter Logic
  const filteredItems = menuItems.filter(item => {
    const matchesSearch = !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || item.category?.name === selectedCategory;
    const matchesBranch = selectedBranch === 'all' || !item.branchId || item.branchId?.toString() === selectedBranch;
    const matchesBrand = selectedBrand === 'all'
      || (selectedBrand === 'none' ? !item.brandId : item.brandId?.toString() === selectedBrand);
    const matchesStatus = selectedStatus === 'all' || (selectedStatus === 'active' ? item.active : !item.active);
    return matchesSearch && matchesCategory && matchesBranch && matchesBrand && matchesStatus
      && (!onlyMissingRecipe || lacksRecipe(item));
  });
  const missingRecipeCount = menuItems.filter(lacksRecipe).length;

  // Stats calculations


  if (loading) {
    return (
      <PageContent>
        <PageHeader title="Menú" description="Cargando platos, costos y ventas…" />
        <Skeleton height={240} />
      </PageContent>
    );
  }

  const handleImageClick = (item: Pick<MenuItem, 'name' | 'images'>, index: number) => {
    const images = item.images?.map(img => img.imageUrl) || [];
    if (images.length > 0) {
      setViewerImages(images);
      setViewerInitialIndex(index);
      setIsViewerOpen(true);
    }
  };

  const showCosts = canSeeCosts;
  const salesById = new Map((engineering ?? []).map((row) => [row.menuItemId, row]));
  const classes = classifyMenu(engineering ?? []);
  const itemClass = (item: MenuItem): ItemClass | null => {
    if (!showCosts || !engineering) return null;
    const recipeCount = item._count?.recipes ?? item.recipes?.length ?? 0;
    if (recipeCount === 0) return 'SIN_RECETA';
    return classes.get(item.id) ?? 'SIN_VENTAS';
  };
  const costRow = (item: MenuItem): MenuSalesRow | null => {
    const row = salesById.get(item.id);
    return row && row.cost > 0 ? row : null;
  };

  const visibleItems = filteredItems.filter((item) => selectedClass === 'all' || itemClass(item) === selectedClass);
  const nd = (reason: string) => <span className={s.nd} title={reason}>N/D</span>;

  const classOptions: Opt<string>[] = [
    { value: 'all', label: 'Toda clasificación' },
    ...(['ESTRELLA', 'CABALLO', 'PUZZLE', 'PERRO', 'SIN_VENTAS'] as const).map((key) => ({ value: key, label: MENU_CLASS_LABEL[key] })),
    { value: 'SIN_RECETA', label: 'Sin receta' },
  ];

  const columns: Column<MenuItem>[] = [
    {
      key: 'name',
      header: 'Plato',
      type: 'text',
      render: (item) => (
        <div className={s.cellStack}>
          <span className={s.cellTitle}>{item.name}</span>
          {item.description && <span className={s.cellSub1} title={item.description}>{item.description}</span>}
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Categoría',
      type: 'text',
      hideBelow: 'md',
      render: (item) => (
        <div className={s.cellStack}>
          <span>{item.category?.name || '-'}</span>
          <span className={s.cellSub}>
            {[item.brand?.name || 'Común', !item.branchId ? 'Global' : branches.find((b) => b.id === item.branchId)?.name || '-'].join(' · ')}
          </span>
        </div>
      ),
    },
    { key: 'price', header: "Precio", type: 'money', accessor: (item) => Number(item.price) },
    ...(showCosts
      ? ([
          {
            key: 'cost',
            header: "Costo",
            type: 'money',
            render: (item) => {
              const row = costRow(item);
              if (row) return formatNumber(row.cost);
              return nd(itemClass(item) === 'SIN_RECETA' ? 'El plato no tiene receta' : engineering ? 'No se pudo calcular el costo de la receta (revisa unidades y costos de los insumos)' : 'No se pudo cargar el costo');
            },
          },
          {
            key: 'foodCost',
            header: 'Food cost',
            type: 'percent',
            render: (item) => {
              const row = costRow(item);
              return row && row.price > 0 ? formatPercent((row.cost / row.price) * 100) : nd('Sin costo conocido');
            },
          },
          {
            key: 'margin',
            header: "Margen",
            type: 'money',
            render: (item) => {
              const row = costRow(item);
              return row ? formatNumber(row.margin) : nd('Sin costo conocido');
            },
          },
          {
            key: 'sold',
            header: 'Vend. 30 d',
            headerTitle: 'Unidades vendidas en los últimos 30 días',
            type: 'number',
            render: (item) => (engineering ? formatNumber(salesById.get(item.id)?.qtySold ?? 0, 0) : nd('No se pudieron cargar las ventas')),
          },
          {
            key: 'class',
            header: 'Clasificación',
            type: 'status',
            render: (item) => {
              const cls = itemClass(item);
              if (!cls) return nd('No se pudo cargar la clasificación');
              const label = cls === 'SIN_RECETA' ? 'Sin receta' : MENU_CLASS_LABEL[cls];
              const hint = cls === 'SIN_RECETA' ? 'Sin receta no hay costo ni descuento de inventario.' : MENU_CLASS_HINT[cls];
              return <span title={hint}><Badge tone={CLASS_TONE[cls]}>{label}</Badge></span>;
            },
          },
        ] as Column<MenuItem>[])
      : []),
    {
      key: 'status',
      header: 'Estado',
      type: 'status',
      render: (item) => (
        <span className={s.rowActions}>
          <Badge tone={item.active ? 'success' : 'neutral'}>{item.active ? 'Activo' : 'Inactivo'}</Badge>
          {lacksRecipe(item) && (
            <span title="Sin receta: la venta no descuenta inventario. Agrega al menos un insumo.">
              <Badge tone="warning">Sin receta</Badge>
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Acciones',
      type: 'actions',
      width: '136px',
      render: (item) => (
        <div className={s.rowActions}>
          <IconButton icon={Eye} size="sm" tooltip="Ver detalle" label={`Ver detalle de ${item.name}`} onClick={() => void handleOpenDetail(item)} />
          {canMutateMenu && <IconButton icon={Pencil} size="sm" tooltip="Editar" label={`Editar ${item.name}`} onClick={() => void handleOpenSidebar(item)} />}
          {canMutateMenu && <IconButton icon={Trash2} size="sm" tone="danger" tooltip="Eliminar" label={`Eliminar ${item.name}`} onClick={() => handleDelete(item.id)} />}
        </div>
      ),
    },
  ];

  const recipeColumns: Column<RecipeRow>[] = [
    {
      key: 'name',
      header: 'Ingrediente',
      type: 'text',
      render: ({ ing }) => (
        <div className={s.cellStack}>
          <span className={s.cellTitle}>{ing.productName}</span>
          {!ing.unitConfigured && <span className={s.unitError}>Unidad no configurada</span>}
        </div>
      ),
    },
    {
      key: 'quantity',
      header: 'Cantidad',
      width: '140px',
      type: 'qty',
      render: ({ ing, index }) => canMutateMenu ? (
        <Input
          type="number"
          min="0.001"
          step="0.001"
          aria-label={`Cantidad de ${ing.productName}`}
          value={ing.quantity}
          onChange={(event) => updateIngredientQuantity(index, event.target.value)}
        />
      ) : `${formatQty(ing.quantity)} ${ing.unit}`,
    },
    ...(canMutateMenu ? ([{
      key: 'unit',
      header: 'Unidad',
      width: '200px',
      render: ({ ing, index }: RecipeRow) => {
        const allowedUnits = recipeUnitsByProduct[ing.productId] || [];
        const unitOptions: Opt<string>[] = allowedUnits.map((unit) => ({
          value: unit.abbreviation,
          label: unit.name && unit.name !== unit.abbreviation ? `${unit.name} (${unit.abbreviation})` : unit.abbreviation,
        }));
        const selectedUnit = unitOptions.find((option) => option.value.toLowerCase() === ing.unit.toLowerCase());
        if (!selectedUnit && ing.unit) unitOptions.push({ value: ing.unit, label: ing.unit });
        return (
          <AppSelect<string>
            aria-label={`Unidad de ${ing.productName}`}
            options={unitOptions}
            value={selectedUnit?.value ?? (ing.unit || null)}
            onChange={(v) => updateIngredientUnit(index, v ?? '')}
            isClearable={false}
            isDisabled={unitOptions.length === 0}
          />
        );
      },
    }] as Column<RecipeRow>[]) : []),
    {
      key: 'cost',
      header: 'Costo',
      type: 'money',
      render: ({ ing }) => (ing.unitConfigured ? formatMoney(calculateIngredientLineCost(ing)) : 'N/D'),
    },
    ...(canMutateMenu ? ([{
      key: 'actions',
      header: 'Acciones',
      type: 'actions',
      width: '72px',
      render: ({ ing, index }: RecipeRow) => (
        <IconButton icon={Trash2} size="sm" tone="danger" tooltip="Quitar" label={`Quitar ${ing.productName}`} onClick={() => removeIngredient(index)} />
      ),
    }] as Column<RecipeRow>[]) : []),
  ];

  const detailComponentColumns: Column<DetailComponentRow>[] = [
    { key: 'index', header: '#', type: 'number', decimals: 0, render: ({ index }) => index + 1 },
    {
      key: 'name',
      header: 'Insumo',
      type: 'text',
      render: ({ component }) => (
        <div className={s.cellStack}>
          <span className={s.cellTitle}>{component.product.name}</span>
          <span className={s.cellSub}>Insumo #{component.product.id}</span>
        </div>
      ),
    },
    {
      key: 'quantity',
      header: 'Cantidad',
      type: 'qty',
      render: ({ component }) => `${formatQty(component.quantity)} ${component.unit || component.unitOfMeasure?.abbreviation || component.product.unit || ''}`,
    },
    {
      key: 'cost',
      header: 'Costo unitario ref.',
      type: 'money',
      render: ({ component }) => formatMoney(effectiveUnitCost(component.product.currentAverageCost, component.product.cost)),
    },
  ];

  const modifierColumns: Column<ModifierRow>[] = [
    {
      key: 'name',
      header: 'Modificador',
      type: 'text',
      render: (modifier) => <span className={s.cellTitle}>{modifier.name}</span>,
    },
    {
      key: 'price',
      header: 'Precio extra',
      type: 'money',
      render: (modifier) => (Number(modifier.price) > 0 ? `+${formatMoney(Number(modifier.price))}` : 'Sin costo'),
    },
    {
      key: 'inventory',
      header: 'Inventario',
      type: 'text',
      render: (modifier) => {
        if (modifier.productId && modifier.inventoryEffect === 'REMOVE') {
          return (
            <span className={s.modInfo}>
              <Package size={14} aria-hidden="true" />
              {modifier.consumeQuantity != null
                ? `Quita ${formatNumber(modifier.consumeQuantity, 3)} ${modifier.unit?.abbreviation || ''} de ${modifier.product?.name || 'producto'} de la receta`
                : `Quita ${modifier.product?.name || 'el ingrediente'} de la receta`}
            </span>
          );
        }
        if (modifier.productId) {
          return (
            <span className={s.modInfo}>
              <Package size={14} aria-hidden="true" />
              Consume {formatNumber(modifier.consumeQuantity ?? 0, 3)} {modifier.unit?.abbreviation || ''} de {modifier.product?.name || 'producto'}
            </span>
          );
        }
        return <span className={s.modMuted}>Sin consumo de inventario</span>;
      },
    },
    {
      key: 'actions',
      header: 'Acciones',
      type: 'actions',
      width: '100px',
      render: (modifier) => (
        <div className={s.rowActions}>
          <IconButton icon={Pencil} size="sm" tooltip="Editar" label={`Editar ${modifier.name}`} onClick={() => handleEditModifier(modifier)} />
          <IconButton icon={Trash2} size="sm" tone="danger" tooltip="Eliminar" label={`Eliminar ${modifier.name}`} onClick={() => void handleDeleteModifier(modifier)} />
        </div>
      ),
    },
  ];

  const priceColumns: Column<PriceRow>[] = [
    {
      key: 'branch',
      header: 'Sucursal',
      type: 'text',
      render: ({ branch, existing }) => (
        <div className={s.cellStack}>
          <span className={s.cellTitle}>{branch.name}</span>
          <span className={s.cellSub}>
            {branch.code ? `${branch.code} · ` : ''}
            {existing ? 'Override activo' : 'Usa precio base'}
          </span>
        </div>
      ),
    },
    {
      key: 'price',
      header: 'Precio',
      type: 'money',
      width: '180px',
      render: ({ branch, existing }) => (
        <Input
          type="number"
          step="0.01"
          prefix={symbol}
          aria-label={`Precio en ${branch.name}`}
          value={branchPriceDrafts[branch.id] ?? amountDraft(existing ? existing.price : formData.price || 0)}
          onChange={(e) => setBranchPriceDrafts((prev) => ({ ...prev, [branch.id]: e.target.value }))}
          readOnly={!canSetBranchPrices}
          disabled={!canSetBranchPrices}
        />
      ),
    },
    {
      key: 'actions',
      header: 'Acciones',
      type: 'actions',
      width: '72px',
      render: ({ branch }) => (
        <IconButton
          icon={Save}
          size="sm"
          tone="primary"
          tooltip={savingBranchPriceId === branch.id ? 'Guardando...' : 'Guardar precio'}
          label={`Guardar precio de ${branch.name}`}
          onClick={() => void handleSaveBranchPrice(branch.id)}
          disabled={!canSetBranchPrices || savingBranchPriceId === branch.id}
        />
      ),
    },
  ];

  const categoryOptions: Opt<string>[] = [
    { value: 'all', label: 'Todas las categorías' },
    ...categories.filter((cat) => isCategoryVisibleInMenu(cat)).map((cat) => ({ value: cat.name, label: cat.name })),
  ];
  const branchOptions: Opt<string>[] = [
    { value: 'all', label: 'Todas las sucursales' },
    ...branches.map((b) => ({ value: b.id.toString(), label: b.name })),
  ];
  const brandOptions: Opt<string>[] = [
    { value: 'all', label: 'Todas las marcas' },
    { value: 'none', label: 'Sin marca (común)' },
    ...brands.map((b) => ({ value: b.id.toString(), label: b.name })),
  ];

  return (
    <PageContent>
    <ImageViewer
      isOpen={isViewerOpen}
      onClose={() => setIsViewerOpen(false)}
      images={viewerImages}
      initialIndex={viewerInitialIndex}
    />
    <PageHeader
      title="Menú"
      description={`${visibleItems.length} platos catalogados en el sistema`}
      actions={
        <>
          <SegmentedControl<ViewMode>
            ariaLabel="Vista"
            iconOnly
            options={[
              { value: 'cards', label: 'Tarjetas', icon: LayoutGrid },
              { value: 'table', label: 'Tabla', icon: Table2 },
            ]}
            value={viewMode}
            onChange={setViewMode}
          />
          {canMutateMenu && (
            <Button variant="primary" icon={Plus} onClick={() => void handleOpenSidebar()}>Nuevo plato</Button>
          )}
        </>
      }
    />

    {showCosts && engineeringError && (
      <LoadErrorState
        message={`${engineeringError} Los costos, ventas y clasificación se muestran como N/D y no entran en ningún total.`}
        onRetry={() => void loadEngineering()}
      />
    )}

    <Tabs
      ariaLabel="Filtrar platos por estado"
      active={selectedStatus}
      onChange={(id) => setSelectedStatus(id as MenuStatusFilter)}
      tabs={STATUS_TABS.map((t) => ({
        ...t,
        badge: t.id === 'all' ? menuItems.length : menuItems.filter((item) => item.active === (t.id === 'active')).length,
      }))}
    />

    <TableToolbar
      actions={canSetBranchPrices ? (
        <Button icon={SlidersHorizontal} onClick={openModifierModal}>Modificadores</Button>
      ) : undefined}
    >
      <Input
        type="search"
        aria-label="Buscar plato"
        placeholder="Buscar plato..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />
      <AppSelect<string>
        aria-label="Filtrar por categoría"
        options={categoryOptions}
        value={selectedCategory}
        onChange={(v) => setSelectedCategory(v ?? 'all')}
        isClearable={false}
      />
      <AppSelect<string>
        aria-label="Filtrar por sucursal"
        options={branchOptions}
        value={selectedBranch}
        onChange={(v) => setSelectedBranch(v ?? 'all')}
        isClearable={false}
      />
      {brands.length > 0 && (
        <AppSelect<string>
          aria-label="Filtrar por marca"
          options={brandOptions}
          value={selectedBrand}
          onChange={(v) => setSelectedBrand(v ?? 'all')}
          isClearable={false}
        />
      )}
      {showCosts && engineering && (
        <AppSelect<string>
          aria-label="Filtrar por clasificación"
          options={classOptions}
          value={selectedClass}
          onChange={(v) => setSelectedClass((v ?? 'all') as ItemClass | 'all')}
          isClearable={false}
        />
      )}
    </TableToolbar>

    {missingRecipeCount > 0 && (
      <div className={s.noRecipeBar} role="status">
        <Badge tone="warning">
          {missingRecipeCount} {missingRecipeCount === 1 ? 'producto no tiene' : 'productos no tienen'} receta y no descuentan inventario al venderse.
        </Badge>
        <Button aria-pressed={onlyMissingRecipe} onClick={() => setOnlyMissingRecipe((value) => !value)}>
          {onlyMissingRecipe ? 'Ver todos' : 'Ver solo sin receta'}
        </Button>
      </div>
    )}

    {viewMode === 'table' && (
      <DataTable<MenuItem>
        ariaLabel="Platos del menú"
        columns={columns}
        rows={visibleItems}
        rowKey={(item) => item.id}
        resetKey={`${selectedCategory}-${selectedBranch}-${selectedBrand}-${selectedStatus}-${onlyMissingRecipe}-${selectedClass}-${searchQuery}`}
        onRowClick={(item) => void handleOpenDetail(item)}
        error={loadError}
        onRetry={() => void loadData()}
        empty={<EmptyState icon={Utensils} title="No hay platos que coincidan con los filtros" />}
      />
    )}

    {viewMode === 'cards' && (
      loadError ? (
        <LoadErrorState message={loadError} onRetry={() => void loadData()} />
      ) : visibleItems.length > 0 ? (
        <div className={`menu-grid ${canMutateMenu ? '' : 'menu-readonly'}`.trim()}>
          {visibleItems.map(item => (
            <MenuItemCard
              key={item.id}
              item={item}
              onClick={() => void handleOpenDetail(item)}
              onEdit={() => handleOpenSidebar(item)}
              onDelete={() => handleDelete(item.id)}
              onImageClick={handleImageClick}
            />
          ))}
        </div>
      ) : (
        <EmptyState icon={Utensils} title="No hay platos que coincidan con los filtros" />
      )
    )}

    <FullScreenModal
      isOpen={detailOpen}
      onClose={() => { setDetailOpen(false); setViewingItem(null); setDetailError(null); }}
      title="Detalle del Plato"
      subtitle={viewingItem?.name}
      footer={viewingItem ? ({ requestClose }) => (
        <>
          <Button onClick={requestClose}>Cerrar</Button>
          {canMutateMenu && (
            <Button
              variant="primary"
              icon={Pencil}
              onClick={() => {
                const item = viewingItem;
                setDetailOpen(false);
                void handleOpenSidebar(item as unknown as MenuItem);
              }}
            >
              Editar plato
            </Button>
          )}
        </>
      ) : undefined}
    >
      {detailLoading && <Skeleton height={200} />}
      {!detailLoading && detailError && (
        <EmptyState
          icon={Utensils}
          title="No se pudo cargar el detalle"
          description={detailError}
          action={<Button onClick={() => setDetailOpen(false)}>Cerrar</Button>}
        />
      )}
      {!detailLoading && viewingItem && (() => {
        const price = Number(viewingItem.price) || 0;
        const hasRecipe = (viewingItem.recipes?.length ?? 0) > 0;
        const totalCost = Number(viewingItem.totalCost) || 0;
        const margin = Number(viewingItem.margin ?? price - totalCost) || 0;
        const marginPercent = price > 0 ? (margin / price) * 100 : 0;
        const branchName = viewingItem.branch?.name
          ?? branches.find((branch) => branch.id === viewingItem.branchId)?.name
          ?? 'Todas las sucursales';

        return (
          <div className={s.detail} data-testid="menu-item-detail">
            <header className={s.detailHead}>
              <h3>{viewingItem.name}</h3>
              <div className={s.inline}>
                <Badge>{viewingItem.category?.name ?? 'Sin categoría'}</Badge>
                <Badge tone={viewingItem.active ? 'success' : 'neutral'} dot>{viewingItem.active ? 'Activo' : 'Inactivo'}</Badge>
                <Badge tone="primary">{viewingItem.recipes?.length ?? 0} componentes</Badge>
              </div>
            </header>

            <FormSection title="Perfil del plato">
              <dl className={s.facts}>
                <div><dt>Categoría</dt><dd>{viewingItem.category?.name ?? 'Sin categoría'}</dd></div>
                <div><dt>Sucursal</dt><dd>{branchName}</dd></div>
                <div><dt>Marca</dt><dd>{viewingItem.brand?.name ?? 'Común'}</dd></div>
                <div><dt>Galería</dt><dd>{viewingItem.images?.length ?? 0} imágenes</dd></div>
              </dl>
            </FormSection>

            <FormSection title="Precio, costo y margen" description="Los costos usan la receta y el costo efectivo vigente de cada insumo (calculado en servidor).">
              <dl className={s.facts}>
                <div><dt>Precio de venta</dt><dd>{formatMoney(price)}</dd></div>
                <div><dt>Costo estimado de receta</dt><dd>{hasRecipe ? formatMoney(totalCost) : 'N/D'}</dd></div>
                <div><dt>Utilidad estimada</dt><dd>{hasRecipe ? formatMoney(margin) : 'N/D'}</dd></div>
                <div><dt>Margen</dt><dd>{hasRecipe ? formatPercent(marginPercent, 1) : 'N/D: el plato no tiene receta'}</dd></div>
              </dl>
            </FormSection>

            <FormSection title="Componentes de la receta">
              <DataTable<DetailComponentRow>
                ariaLabel="Componentes de la receta"
                variant="flat"
                columns={detailComponentColumns}
                rows={(viewingItem.recipes ?? []).map((component, index) => ({ component, index }))}
                rowKey={(row) => row.component.id}
                empty="Este plato no tiene componentes de receta registrados."
                hidePaginationIfSinglePage
                stackOnMobile
              />
            </FormSection>

            {viewingBranchPrices.length > 0 && (
              <FormSection title="Precios por sucursal">
                <dl className={s.facts}>
                  {viewingBranchPrices.map((row) => (
                    <div key={row.branchId}>
                      <dt>{branches.find((branch) => branch.id === row.branchId)?.name ?? `Sucursal #${row.branchId}`}</dt>
                      <dd>{formatMoney(Number(row.price))}</dd>
                    </div>
                  ))}
                </dl>
              </FormSection>
            )}

            {Boolean(viewingItem.images?.length) && (
              <FormSection title="Galería">
                <div className={s.gallery}>
                  {viewingItem.images?.map((image, index) => (
                    <button key={image.id} type="button" className={s.galleryButton} onClick={() => handleImageClick(viewingItem, index)} aria-label={`Abrir imagen ${index + 1} de ${viewingItem.name}`}>
                      <img src={image.imageUrl} alt={`${viewingItem.name} ${index + 1}`} />
                    </button>
                  ))}
                </div>
              </FormSection>
            )}

            <FormSection title="Descripción">
              <p className={s.description}>{viewingItem.description || 'Este plato no tiene descripción adicional.'}</p>
            </FormSection>
          </div>
        );
      })()}
    </FullScreenModal>

    <FullScreenModal
      isOpen={isSidebarOpen}
      onClose={() => { setIsSidebarOpen(false); setActiveTab('info'); }}
      title={editingItem ? 'Editar Plato' : 'Nuevo Plato'}
      subtitle={editingItem?.name}
      aside={(() => {
        const price = parseFloat(formData.price) || 0;
        const unconfigured = recipe.filter((ing) => !ing.unitConfigured).length;
        const totalCost = recipe.reduce((sum, ing) => sum + calculateIngredientLineCost(ing), 0);
        const hasCost = recipe.length > 0 && unconfigured < recipe.length;
        const profit = price - totalCost;
        const margin = price > 0 ? (profit / price) * 100 : 0;
        const foodCost = price > 0 ? (totalCost / price) * 100 : 0;
        const known = hasCost && price > 0;
        return (
          <section className={s.costPanel} aria-label="Costeo del plato">
            <h3>Costeo</h3>
            <div className={s.costRow}><span>Precio de venta</span><strong>{price > 0 ? formatMoney(price) : 'N/D'}</strong></div>
            <div className={s.costRow}><span>Costo de materia prima</span><strong>{hasCost ? formatMoney(totalCost) : 'N/D'}</strong></div>
            <div className={s.costRow}><span>Utilidad por plato</span><strong>{known ? formatMoney(profit) : 'N/D'}</strong></div>
            <div className={s.costRow}>
              <span>Costo de alimentos</span>
              <strong>
                {known ? formatPercent(foodCost, 1) : 'N/D'}
                {known && goals.foodCostPct > 0 && (
                  <Badge tone={foodCost <= goals.foodCostPct ? 'success' : 'danger'}>meta ≤ {formatPercent(goals.foodCostPct, 0)}</Badge>
                )}
              </strong>
            </div>
            <div className={s.costRow}>
              <span>Margen</span>
              <strong>
                {known ? formatPercent(margin, 1) : 'N/D'}
                {known && goals.grossMarginPct > 0 && (
                  <Badge tone={margin >= goals.grossMarginPct ? 'success' : 'warning'}>meta ≥ {formatPercent(goals.grossMarginPct, 0)}</Badge>
                )}
              </strong>
            </div>
            <p className={s.costNote}>
              {hasCost
                ? `Suma de ${recipe.length - unconfigured} ingredientes.${unconfigured > 0 ? ` Excluye ${unconfigured} con unidad no configurada.` : ''}`
                : 'Agrega ingredientes con unidad configurada en la pestaña Costos para calcular el costo.'}
              {goals.foodCostPct > 0 || goals.grossMarginPct > 0 ? ' Metas desde Configuración.' : ''}
            </p>
          </section>
        );
      })()}
      tabs={[
        { id: 'info', label: 'Información' },
        { id: 'recipe', label: 'Costos' },
        { id: 'gallery', label: 'Galería' },
        ...(editingItem ? [{ id: 'pricing', label: 'Precios' }] : []),
      ]}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as typeof activeTab)}
      footer={({ requestClose }) => (
        <>
          <Button onClick={requestClose}>{canMutateMenu ? 'Cancelar' : 'Cerrar'}</Button>
          {canMutateMenu && (
            <Button type="submit" form="menu-item-form" variant="primary" loading={saving} disabled={!formData.name || saving}>
              {saving ? 'Guardando...' : editingItem ? 'Actualizar Plato' : 'Guardar en Catálogo'}
            </Button>
          )}
        </>
      )}
    >
      <form id="menu-item-form" onSubmit={handleSubmit} className={s.form}>
        {activeTab === 'info' && (
          <FormSection title="Información del plato">
            <FormGrid>
              <Field label="Nombre del plato" htmlFor="menu-item-name" required>
                <Input
                  id="menu-item-name"
                  autoFocus
                  placeholder="Ej: Pasta Carbonara Premium"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  readOnly={!canMutateMenu}
                  disabled={!canMutateMenu}
                />
              </Field>
              <Field label="Precio final" htmlFor="menu-item-price" required>
                <Input
                  id="menu-item-price"
                  type="number"
                  step="0.01"
                  prefix={symbol}
                  placeholder="0.00"
                  value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                  required
                  readOnly={!canMutateMenu}
                  disabled={!canMutateMenu}
                />
              </Field>
              <Checkbox
                label="Activo (visible en POS y menú)"
                checked={formData.active}
                onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                disabled={!canMutateMenu}
              />
              <Field label="Categoría" htmlFor="menu-item-category">
                <AppSelect<string>
                  inputId="menu-item-category"
                  options={categories.filter(cat => isCategoryVisibleInMenu(cat) || cat.id.toString() === formData.categoryId).map(cat => ({ value: cat.id.toString(), label: cat.name }))}
                  value={formData.categoryId || null}
                  onChange={(v) => setFormData({ ...formData, categoryId: v ?? '' })}
                  placeholder="Seleccionar..."
                  isDisabled={!canMutateMenu}
                />
              </Field>
              <Field label="Sucursal" htmlFor="menu-item-branch">
                <AppSelect<string>
                  inputId="menu-item-branch"
                  options={[
                    { value: '', label: 'Todas las Sucursales (Global)' },
                    ...branches.map((b) => ({ value: b.id.toString(), label: b.name })),
                  ]}
                  value={formData.branchId}
                  onChange={(v) => setFormData({ ...formData, branchId: v ?? '' })}
                  isClearable={false}
                  isDisabled={!canMutateMenu}
                />
              </Field>
              <Field label="Marca" htmlFor="menu-item-brand">
                <AppSelect<string>
                  inputId="menu-item-brand"
                  options={[
                    { value: '', label: 'Común (todas las marcas)' },
                    ...brands.filter(b => b.active || b.id.toString() === formData.brandId).map((b) => ({ value: b.id.toString(), label: b.name })),
                  ]}
                  value={formData.brandId}
                  onChange={(v) => setFormData({ ...formData, brandId: v ?? '' })}
                  isClearable={false}
                  isDisabled={!canMutateMenu}
                />
              </Field>
            </FormGrid>
            <Field label="Descripción" htmlFor="menu-item-description">
              <Textarea
                id="menu-item-description"
                rows={4}
                placeholder="Detalles sobre sabores, ingredientes o preparación..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                readOnly={!canMutateMenu}
                disabled={!canMutateMenu}
              />
            </Field>
          </FormSection>
        )}

        {activeTab === 'recipe' && (() => {
          return (
            <FormSection title="Análisis de costos y receta">
              <Field label="Incorporar ingrediente" htmlFor="menu-ingredient-product">
                <div className={s.addRow} role="group" aria-label="Incorporar ingrediente">
                  <div className={s.addProduct}>
                    <AppSelect<string>
                      inputId="menu-ingredient-product"
                      options={products.map(p => ({ value: p.id.toString(), label: p.name }))}
                      value={selectedProductId || null}
                      onChange={(v) => void handleIngredientProductChange(v ?? '')}
                      placeholder="Buscar..."
                      isDisabled={!canMutateMenu}
                    />
                  </div>
                  <div className={s.addQty}>
                    <Input
                      id="menu-ingredient-quantity"
                      type="number"
                      min="0.001"
                      step="0.001"
                      aria-label="Cantidad del ingrediente"
                      placeholder="Cant"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      readOnly={!canMutateMenu}
                      disabled={!canMutateMenu}
                    />
                  </div>
                  {selectedProductId && (
                    <div className={s.addUnit}>
                      <AppSelect<string>
                        inputId="menu-ingredient-unit"
                        aria-label="Unidad del ingrediente"
                        options={ingredientUnits.map((u) => ({
                          value: u.abbreviation,
                          label: u.name && u.name !== u.abbreviation ? `${u.name} (${u.abbreviation})` : u.abbreviation,
                        }))}
                        value={selectedIngredientUnit || null}
                        onChange={(v) => setSelectedIngredientUnit(v ?? '')}
                        isDisabled={!canMutateMenu || ingredientUnits.length === 0}
                        placeholder="Unidad"
                      />
                    </div>
                  )}
                  <Button
                    variant="primary"
                    icon={Plus}
                    aria-label="Agregar ingrediente"
                    onClick={addIngredient}
                    disabled={!canMutateMenu || !selectedProductId || !quantity || Number(quantity) <= 0}
                  >
                    Agregar
                  </Button>
                </div>
              </Field>

              <div role="group" aria-labelledby="menu-ingredients-list-label">
                <p className={s.sectionLabel} id="menu-ingredients-list-label">Ingredientes seleccionados</p>
                <DataTable<RecipeRow>
                  ariaLabel="Ingredientes de la receta"
                  variant="flat"
                  columns={recipeColumns}
                  rows={recipe.map((ing, index) => ({ ing, index }))}
                  rowKey={(row) => row.ing.id ?? `new-${row.ing.productId}`}
                  empty="Sin ingredientes registrados"
                  hidePaginationIfSinglePage
                  defaultPageSize={100}
                  stackOnMobile
                />
              </div>
            </FormSection>
          );
        })()}

        {activeTab === 'gallery' && (
          <FormSection title="Galería de imágenes" description="Hasta 3 imágenes; la primera es la principal.">
            <div className={s.gallery}>
              {images.map((img, i) => (
                <div key={i} className={s.galleryItem}>
                  <img src={img} alt={`Imagen ${i + 1} del plato`} />
                  {i === 0 && <span className={s.galleryMain}>Principal</span>}
                  {canMutateMenu ? (
                    <span className={s.galleryRemove}>
                      <IconButton icon={Trash2} size="sm" tone="danger" tooltip="Quitar" label={`Quitar imagen ${i + 1}`} onClick={() => removeImage(i)} />
                    </span>
                  ) : null}
                </div>
              ))}
              {images.length < 3 && canMutateMenu && (
                <label className={s.galleryUpload}>
                  <input
                    type="file"
                    accept=".png,.jpg,.jpeg,.gif,.webp"
                    multiple
                    onChange={handleImageUpload}
                    className={s.srOnlyInput}
                  />
                  <ImagePlus size={24} aria-hidden="true" />
                  <span>Cargar imagen</span>
                </label>
              )}
            </div>
          </FormSection>
        )}

        {activeTab === 'pricing' && editingItem && (
          <FormSection
            title="Precios por sucursal"
            description={formData.branchId
              ? 'Este plato es exclusivo de una sucursal. Los precios de abajo permiten ajustes adicionales por local.'
              : 'Este plato es global. Cada sucursal puede sobrescribir el precio base si lo necesita.'}
          >
            <dl className={s.facts}>
              <div>
                <dt>Precio base {formData.branchId ? '(sucursal propia)' : '(global)'}</dt>
                <dd>{formatMoney(Number(formData.price || 0))}</dd>
              </div>
            </dl>
            <DataTable<PriceRow>
              ariaLabel="Precios por sucursal"
              variant="flat"
              columns={priceColumns}
              rows={branches.map((branch) => ({ branch, existing: branchPricing.find((priceRow) => priceRow.branchId === branch.id) }))}
              rowKey={(row) => row.branch.id}
              empty="No hay sucursales registradas."
              hidePaginationIfSinglePage
              defaultPageSize={100}
              stackOnMobile
            />
          </FormSection>
        )}
      </form>
    </FullScreenModal>

    <FullScreenModal
      isOpen={isModifierModalOpen}
      onClose={() => { setIsModifierModalOpen(false); resetModifierForm(); }}
      title="Modificadores"
      subtitle="Grupos, precios extra y consumo de inventario"
      footerStart={editingModifierId ? <Button onClick={resetModifierForm}>Cancelar edición</Button> : undefined}
      footer={({ requestClose }) => (
        <>
          <Button onClick={requestClose}>Cerrar</Button>
          {selectedGroupId && (
            <Button
              variant="primary"
              type="submit"
              form="modifier-form"
              disabled={savingModifier || !modifierForm.name.trim()}
              loading={savingModifier}
            >
              {savingModifier ? 'Guardando...' : editingModifierId ? 'Actualizar modificador' : 'Agregar modificador'}
            </Button>
          )}
        </>
      )}
    >
      <div className={s.form}>
        <FormSection title="Grupos de modificadores">
          {modifierGroups.length > 0 ? (
            <Tabs
              ariaLabel="Grupos de modificadores"
              active={selectedGroupId != null ? String(selectedGroupId) : ''}
              onChange={(id) => { setSelectedGroupId(Number(id)); resetModifierForm(); }}
              tabs={modifierGroups.map((group) => ({ id: String(group.id), label: group.name, badge: group.modifiers.length }))}
            />
          ) : (
            <EmptyState icon={SlidersHorizontal} title="Aún no hay grupos" description="Crea uno para empezar." />
          )}

          <div className={s.groupToolbar} role="group" aria-label="Agregar grupo de modificadores">
            <div className={s.groupToolbarField}>
              <Field label="Nuevo grupo" htmlFor="menu-new-modifier-group">
                <Input
                  id="menu-new-modifier-group"
                  placeholder="Ej: Extras, Tamaño"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleCreateGroup(); } }}
                />
              </Field>
            </div>
            <Button icon={Plus} onClick={() => void handleCreateGroup()} disabled={!newGroupName.trim()}>Agregar grupo</Button>
          </div>
        </FormSection>

        {selectedGroupId && (
          <>
            <FormSection title="Modificadores del grupo">
              <DataTable<ModifierRow>
                ariaLabel="Modificadores del grupo"
                variant="flat"
                columns={modifierColumns}
                rows={modifierGroups.find((g) => g.id === selectedGroupId)?.modifiers ?? []}
                rowKey={(modifier) => modifier.id}
                empty="Este grupo no tiene modificadores."
                hidePaginationIfSinglePage
                stackOnMobile
              />
            </FormSection>

            <FormSection title={editingModifierId ? 'Editar modificador' : 'Nuevo modificador'}>
              <form id="modifier-form" onSubmit={(e) => { e.preventDefault(); void handleSaveModifier(); }}>
                <FormGrid>
                  <Field label="Nombre" htmlFor="modifier-name">
                    <Input
                      id="modifier-name"
                      placeholder="Ej: Queso extra"
                      value={modifierForm.name}
                      onChange={(e) => setModifierForm({ ...modifierForm, name: e.target.value })}
                    />
                  </Field>
                  <Field label="Precio extra" htmlFor="modifier-price">
                    <Input
                      id="modifier-price"
                      type="number"
                      step="0.01"
                      prefix={symbol}
                      placeholder="0.00"
                      value={modifierForm.extraPrice}
                      onChange={(e) => setModifierForm({ ...modifierForm, extraPrice: e.target.value })}
                    />
                  </Field>
                  <Field label="Efecto en inventario" htmlFor="modifier-effect">
                    <AppSelect<ModifierInventoryEffect>
                      inputId="modifier-effect"
                      options={INVENTORY_EFFECT_OPTIONS}
                      value={modifierForm.inventoryEffect}
                      onChange={(v) => setModifierForm({ ...modifierForm, inventoryEffect: v === 'REMOVE' ? 'REMOVE' : 'ADD' })}
                      isClearable={false}
                    />
                  </Field>
                  <Field
                    label={modifierForm.inventoryEffect === 'REMOVE' ? 'Ingrediente de la receta a quitar' : 'Producto / insumo a consumir (opcional)'}
                    htmlFor="modifier-product"
                  >
                    <AppSelect<string>
                      inputId="modifier-product"
                      options={modifierProducts.map((p) => ({ value: String(p.id), label: p.sku ? `${p.name} (${p.sku})` : p.name }))}
                      value={modifierForm.productId || null}
                      onChange={(v) => setModifierForm({ ...modifierForm, productId: v ?? '', ...(v ? {} : { consumeQuantity: '', unitId: '' }) })}
                      placeholder="Sin vínculo de inventario"
                    />
                  </Field>
                  <Field label={modifierForm.inventoryEffect === 'REMOVE' ? 'Cantidad a quitar (vacío = todo)' : 'Cantidad a consumir'} htmlFor="modifier-qty">
                    <Input
                      id="modifier-qty"
                      type="number"
                      step="0.001"
                      placeholder="0.000"
                      value={modifierForm.consumeQuantity}
                      onChange={(e) => setModifierForm({ ...modifierForm, consumeQuantity: e.target.value })}
                      disabled={!modifierForm.productId}
                    />
                  </Field>
                  <Field label="Unidad" htmlFor="modifier-unit">
                    <AppSelect<string>
                      inputId="modifier-unit"
                      options={units.map((u) => ({ value: String(u.id), label: `${u.name} (${u.abbreviation})` }))}
                      value={modifierForm.unitId || null}
                      onChange={(v) => setModifierForm({ ...modifierForm, unitId: v ?? '' })}
                      placeholder="Unidad base del producto"
                      isDisabled={!modifierForm.productId}
                    />
                  </Field>
                </FormGrid>
              </form>
            </FormSection>
          </>
        )}
      </div>
    </FullScreenModal>
    </PageContent>
  );
}

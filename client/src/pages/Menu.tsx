import { useState, useEffect, useCallback } from 'react';
import Select from '../components/Select';
import { branchPricingAPI, menuAPI, productsAPI, categoriesAPI, branchesAPI, unitsAPI, menuBrandsAPI, modifiersAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { hasAnyRole } from '../utils/authz';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
import {
  Plus, Utensils, Trash2, Image as ImageIcon,
  Info, PieChart, ImagePlus, DollarSign, Edit2,
  SlidersHorizontal, Package, Eye, Layers, Building2, Tag
} from 'lucide-react';
import ViewToggle from '../components/ViewToggle';
import CatalogTable, { type CatalogColumn } from '../components/CatalogTable';
import { useViewMode } from '../hooks/useViewMode';
import { currencyInputPadding } from '../utils/currency';
import type { Branch, MenuItem, MenuBrand, MenuRecipe, Product, ProductAllowedUnit, UnitOfMeasure } from '../types';
import type { SingleValue } from 'react-select';
import {
  buildMenuRecipeSyncPlan,
  calculateMenuRecipeLineCost,
  type EditableMenuRecipe,
  validateMenuRecipes,
} from '../utils/menuRecipe';

type CatFilterOption = { value: string; label: string };
import MenuItemCard from '../components/MenuItemCard';
import { useCurrency } from '../hooks/useCurrency';
import ImageViewer from '../components/ImageViewer';
import { isCategoryVisibleInMenu } from '../utils/categoryVisibility';
import { effectiveUnitCost } from '../utils/productCost';
import './Menu.css';
import './Inventory.css';

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

type StrOption = { value: string; label: string };

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
  product?: { id: number; name: string } | null;
  unit?: { id: number; name: string; abbreviation: string } | null;
}

interface ModifierGroupRow {
  id: number;
  name: string;
  description?: string | null;
  modifiers: ModifierRow[];
}

// Products eligible to be consumed by a modifier (insumos / empaques / intermedios).
const MODIFIER_PRODUCT_TYPES: Product['type'][] = ['INGREDIENT', 'BOTH', 'INTERMEDIATE', 'PACKAGING'];
const RECIPE_PRODUCT_TYPES: Product['type'][] = ['INGREDIENT', 'BOTH', 'INTERMEDIATE', 'PACKAGING'];

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
  const { confirm } = useConfirmDialog();
  const { error: showError, warning: showWarning, success: showSuccess } = useAppToast();
  /** Backend: menu/recipe/image mutations require SUPERADMIN | ADMIN | CHEF. */
  const canMutateMenu = hasAnyRole(user, ['SUPERADMIN', 'ADMIN', 'CHEF']);
  /** Backend: branch price overrides via /advanced/pricing require SUPERADMIN | ADMIN */
  const canSetBranchPrices = hasAnyRole(user, ['SUPERADMIN', 'ADMIN']);

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [brands, setBrands] = useState<MenuBrand[]>([]);
  const [selectedBrand, setSelectedBrand] = useState<string>('all');
  const { viewMode, setViewMode } = useViewMode('menu');

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
    brandId: ''
  });

  const [recipe, setRecipe] = useState<EditableMenuRecipe[]>([]);
  const [originalRecipe, setOriginalRecipe] = useState<EditableMenuRecipe[]>([]);
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
    unitId: ''
  });
  const [savingModifier, setSavingModifier] = useState(false);

  const calculateIngredientLineCost = calculateMenuRecipeLineCost;

  const loadData = useCallback(async () => {
    try {
      const [menuRes, productsRes, categoriesRes, branchesRes, brandsRes] = await Promise.all([
        menuAPI.getAll({ active: true }),
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
    } catch (error) {
      console.error('Error loading data:', error);
      showError(errMsg(error, 'No se pudo cargar el menú y sus ingredientes'));
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const resetModifierForm = () => {
    setEditingModifierId(null);
    setModifierForm({ name: '', extraPrice: '', productId: '', consumeQuantity: '', unitId: '' });
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
      showError('No se pudieron cargar los modificadores');
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
      showError('No se pudo crear el grupo');
    }
  };

  const handleEditModifier = (modifier: ModifierRow) => {
    setEditingModifierId(modifier.id);
    setModifierForm({
      name: modifier.name,
      extraPrice: modifier.price != null ? String(modifier.price) : '',
      productId: modifier.productId != null ? String(modifier.productId) : '',
      consumeQuantity: modifier.consumeQuantity != null ? String(modifier.consumeQuantity) : '',
      unitId: modifier.unitId != null ? String(modifier.unitId) : ''
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
    if (hasProduct && (modifierForm.consumeQuantity === '' || Number(modifierForm.consumeQuantity) <= 0)) {
      showWarning('Indica una cantidad a consumir mayor a 0');
      return;
    }

    const payload: Record<string, unknown> = {
      name,
      extraPrice: modifierForm.extraPrice === '' ? 0 : Number(modifierForm.extraPrice),
      // Send explicit null to unlink when no product is selected.
      productId: hasProduct ? Number(modifierForm.productId) : null,
      consumeQuantity: hasProduct ? Number(modifierForm.consumeQuantity) : null,
      unitId: hasProduct && modifierForm.unitId !== '' ? Number(modifierForm.unitId) : null
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
      showError('No se pudo guardar el modificador');
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
      showError('No se pudo eliminar el modificador');
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
        brandId: item.brandId?.toString() || ''
      });
      // Never leave data from the previously-opened item in the editor while
      // this item's imported recipe is being loaded.
      setRecipe([]);
      setOriginalRecipe([]);
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
        setOriginalRecipe(loadedRecipes.map((ingredient) => ({ ...ingredient })));
        setRecipeUnitsByProduct(Object.fromEntries(productUnitsMap));
        setImages(loadedImages);
        setOriginalImages(loadedImageRecords);
        setBranchPricing(pricingRes.data.data.branchPrices || []);
        setBranchPriceDrafts(
          (pricingRes.data.data.branchPrices || []).reduce((acc: Record<number, string>, priceRow: BranchPriceRow) => {
            acc[priceRow.branchId] = Number(priceRow.price).toFixed(2);
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
      setFormData({ name: '', description: '', price: '', categoryId: '', branchId: '', brandId: '' });
      setRecipe([]);
      setOriginalRecipe([]);
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
          acc[priceRow.branchId] = Number(priceRow.price).toFixed(2);
          return acc;
        }, {})
      );
    } catch (error) {
      console.error('Error saving branch price:', error);
      showError('No se pudo guardar el precio por sucursal');
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
    const recipeValidationError = validateMenuRecipes(recipe);
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
        active: true
      };

      let menuItemId: number;
      if (editingItem) {
        await menuAPI.update(editingItem.id, menuData);
        menuItemId = editingItem.id;

        const syncPlan = buildMenuRecipeSyncPlan(originalRecipe, recipe);

        // Update retained lines first. Removed rows are deleted before creates so
        // replacing the same product cannot hit the unique menuItem/product key.
        await Promise.all(syncPlan.update.map(({ id, data }) => menuAPI.updateRecipe(id, data)));
        await Promise.all(syncPlan.delete.map((recipeId) => menuAPI.deleteRecipe(recipeId)));
        await Promise.all(syncPlan.create.map((ingredient) => menuAPI.addRecipe(menuItemId, ingredient)));

        const retainedImageUrls = new Set(images);
        const originalImageUrls = new Set(originalImages.map((image) => image.imageUrl));
        const removedImages = originalImages.filter((image) => !retainedImageUrls.has(image.imageUrl));
        const addedImages = images.filter((imageUrl) => !originalImageUrls.has(imageUrl));
        await Promise.all(removedImages.map((image) => menuAPI.deleteImage(image.id)));
        await Promise.all(addedImages.map((imageUrl) => menuAPI.addImage(menuItemId, imageUrl)));
      } else {
        const response = await menuAPI.create(menuData);
        menuItemId = response.data.data.id;
        await Promise.all(recipe.map((ingredient) => menuAPI.addRecipe(menuItemId, {
          productId: ingredient.productId,
          quantity: Number(ingredient.quantity),
          unit: ingredient.unit.trim(),
        })));
        await Promise.all(images.map((imageUrl) => menuAPI.addImage(menuItemId, imageUrl)));
      }

      setIsSidebarOpen(false);
      await loadData();
      showSuccess(editingItem ? 'Plato y receta actualizados' : 'Plato y receta creados');
    } catch (error: unknown) {
      console.error('Error saving menu item:', error);
      const message = errMsg(error, 'Error al guardar el plato y su receta');

      // Line and image synchronisation uses several API requests. If one fails,
      // the server may already contain a subset of the changes; prevent retrying
      // with stale original IDs and force the next open to read authoritative data.
      setIsSidebarOpen(false);
      setEditingItem(null);
      setRecipe([]);
      setOriginalRecipe([]);
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
    } catch {
      showError('Error al eliminar');
    }
  };

  // Filter Logic
  const filteredItems = menuItems.filter(item => {
    const matchesSearch = !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || item.category?.name === selectedCategory;
    const matchesBranch = selectedBranch === 'all' || !item.branchId || item.branchId?.toString() === selectedBranch;
    const matchesBrand = selectedBrand === 'all'
      || (selectedBrand === 'none' ? !item.brandId : item.brandId?.toString() === selectedBrand);
    return matchesSearch && matchesCategory && matchesBranch && matchesBrand;
  });

  // Stats calculations


  if (loading) return <div className="menu-loading">Sincronizando Menú...</div>;

  const handleImageClick = (item: Pick<MenuItem, 'name' | 'images'>, index: number) => {
    const images = item.images?.map(img => img.imageUrl) || [];
    if (images.length > 0) {
      setViewerImages(images);
      setViewerInitialIndex(index);
      setIsViewerOpen(true);
    }
  };

  return (
    <div className={`menu-page${!canMutateMenu ? ' menu-readonly' : ''}`}>
      <ImageViewer
        isOpen={isViewerOpen}
        onClose={() => setIsViewerOpen(false)}
        images={viewerImages}
        initialIndex={viewerInitialIndex}
      />
      {/* Header View */}
      <div className="menu-header">
        <div>
          <h1><Utensils size={32} /> Gestión de Menú</h1>
          <p className="menu-subtitle">{filteredItems.length} platos catalogados en el sistema</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <ViewToggle value={viewMode} onChange={setViewMode} />
          {canSetBranchPrices && (
            <Button variant="secondary" onClick={openModifierModal}>
              <SlidersHorizontal size={18} />
              Modificadores
            </Button>
          )}
          {canMutateMenu && (
            <Button onClick={() => handleOpenSidebar()}>
              <Plus size={18} />
              Nuevo Plato
            </Button>
          )}
        </div>
      </div>

      {/* Modern Filter Row */}
      <div className="menu-filters-bar">
        <div className="menu-filters-row">
          <Select
            className="category-select-container"
            value={selectedCategory === 'all'
              ? { value: 'all', label: 'Todas las Categorías' }
              : { value: selectedCategory, label: selectedCategory }}
            onChange={(val: SingleValue<CatFilterOption>) => setSelectedCategory(val?.value || 'all')}
            options={[
              { value: 'all', label: 'Todas las Categorías' },
              ...categories.filter(cat => isCategoryVisibleInMenu(cat)).map(cat => ({ value: cat.name, label: cat.name }))
            ]}
            placeholder="Filtrar por categoría..."
            isSearchable
          />

          <Select
            className="branch-select-container"
            value={
              selectedBranch === 'all'
                ? { value: 'all', label: 'Todas las Sucursales' }
                : { value: selectedBranch, label: branches.find((b) => b.id.toString() === selectedBranch)?.name || 'Sucursal' }
            }
            onChange={(val: SingleValue<CatFilterOption>) => setSelectedBranch(val?.value || 'all')}
            options={[
              { value: 'all', label: 'Todas las Sucursales' },
              ...branches.map((b) => ({ value: b.id.toString(), label: b.name }))
            ]}
            placeholder="Sucursal..."
            isSearchable={false}
          />

          {brands.length > 0 && (
            <Select
              className="branch-select-container"
              value={
                selectedBrand === 'all'
                  ? { value: 'all', label: 'Todas las Marcas' }
                  : { value: selectedBrand, label: brands.find((b) => b.id.toString() === selectedBrand)?.name || 'Marca' }
              }
              onChange={(val: SingleValue<CatFilterOption>) => setSelectedBrand(val?.value || 'all')}
              options={[
                { value: 'all', label: 'Todas las Marcas' },
                { value: 'none', label: 'Sin marca (común)' },
                ...brands.map((b) => ({ value: b.id.toString(), label: b.name }))
              ]}
              placeholder="Marca..."
              isSearchable={false}
            />
          )}

          <input
            type="text"
            className="search-input"
            placeholder="Buscar por nombre o descripción..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {viewMode === 'table' && filteredItems.length > 0 && (
        <CatalogTable<MenuItem>
          rows={filteredItems}
          rowKey={(item) => item.id}
          resetKey={`${selectedCategory}-${selectedBranch}-${selectedBrand}-${searchQuery}`}
          columns={[
            {
              key: 'name',
              header: 'Plato',
              render: (item) => (
                <div className="catalog-cell-stack">
                  <span className="cell-title">{item.name}</span>
                  {item.description && <span className="cell-sub">{item.description}</span>}
                </div>
              ),
            },
            {
              key: 'category',
              header: 'Categoría',
              render: (item) => item.category?.name || '-',
            },
            {
              key: 'brand',
              header: 'Marca',
              render: (item) => item.brand?.name || 'Común',
            },
            {
              key: 'branch',
              header: 'Sucursal',
              render: (item) => {
                if (!item.branchId) return 'Global';
                return branches.find((b) => b.id === item.branchId)?.name || '-';
              },
            },
            {
              key: 'price',
              header: 'Precio',
              align: 'right',
              render: (item) => formatMoney(Number(item.price)),
            },
            {
              key: 'status',
              header: 'Estado',
              render: (item) => (
                <span className={`catalog-pill ${item.active ? 'ok' : 'neutral'}`}>
                  {item.active ? 'Activo' : 'Inactivo'}
                </span>
              ),
            },
            {
              key: 'actions',
              header: 'Acciones',
              align: 'right',
              render: (item) => (
                <div className="catalog-table-actions">
                  <button
                    type="button"
                    className="catalog-action-btn"
                    onClick={() => void handleOpenDetail(item)}
                    title="Ver detalle"
                    aria-label={`Ver detalle de ${item.name}`}
                  >
                    <Eye size={16} />
                  </button>
                  {canMutateMenu && (
                  <button
                    type="button"
                    className="catalog-action-btn"
                    onClick={() => handleOpenSidebar(item)}
                    title="Editar"
                    aria-label={`Editar ${item.name}`}
                  >
                    <Edit2 size={16} />
                  </button>
                  )}
                  {canMutateMenu && (
                    <button
                      type="button"
                      className="catalog-action-btn danger"
                      onClick={() => handleDelete(item.id)}
                      title="Eliminar"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ),
            },
          ] as CatalogColumn<MenuItem>[]}
        />
      )}

      {viewMode === 'cards' && (
        <div className="menu-grid">
          {filteredItems.map(item => (
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
      )}

      {filteredItems.length === 0 && (
        <div className="menu-empty-state">
          <Utensils size={48} />
          <p>No hay platos que coincidan con los filtros</p>
        </div>
      )}

      <Sidebar
        isOpen={detailOpen}
        onClose={() => { setDetailOpen(false); setViewingItem(null); setDetailError(null); }}
        title="Detalle del Plato"
        width="large"
        footer={viewingItem ? (
          <div className="inventory-detail-footer">
            <Button type="button" variant="ghost" onClick={() => setDetailOpen(false)}>
              Cerrar
            </Button>
            {canMutateMenu && (
              <Button
                type="button"
                onClick={() => {
                  const item = viewingItem;
                  setDetailOpen(false);
                  void handleOpenSidebar(item as unknown as MenuItem);
                }}
              >
                <Edit2 size={16} /> Editar plato
              </Button>
            )}
          </div>
        ) : undefined}
      >
        {detailLoading && <div className="inventory-loading">Cargando detalle del plato...</div>}
        {!detailLoading && detailError && (
          <div className="state-placeholder" role="alert">
            <Utensils size={42} />
            <p className="state-error">{detailError}</p>
            <Button variant="ghost" onClick={() => setDetailOpen(false)}>Cerrar</Button>
          </div>
        )}
        {!detailLoading && viewingItem && (() => {
          const price = Number(viewingItem.price) || 0;
          const totalCost = Number(viewingItem.totalCost) || 0;
          const margin = Number(viewingItem.margin ?? price - totalCost) || 0;
          const marginPercent = price > 0 ? (margin / price) * 100 : 0;
          const branchName = viewingItem.branch?.name
            ?? branches.find((branch) => branch.id === viewingItem.branchId)?.name
            ?? 'Todas las sucursales';

          return (
            <div className="inventory-detail menu-item-detail" data-testid="menu-item-detail">
              <div className="inventory-detail-hero">
                <div className="inventory-detail-hero-main">
                  <div className="inventory-detail-icon" aria-hidden="true"><Utensils size={28} /></div>
                  <div className="inventory-detail-identity">
                    <span className="inventory-detail-eyebrow">Ficha del catálogo</span>
                    <h3>{viewingItem.name}</h3>
                    <div className="inventory-detail-meta">
                      <span className="inventory-detail-badge sku">{viewingItem.category?.name ?? 'Sin categoría'}</span>
                      <div className="inventory-detail-status-row">
                        <span className={`inventory-detail-badge ${viewingItem.active ? 'active' : 'inactive'}`}>
                          {viewingItem.active ? 'Activo' : 'Inactivo'}
                        </span>
                        <span className="inventory-detail-badge ok">{viewingItem.recipes?.length ?? 0} componentes</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="inventory-detail-stock-summary menu-item-price-summary">
                  <span>Precio de venta</span>
                  <strong>{formatMoney(price)}</strong>
                  <div className="inventory-detail-stock-track" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, marginPercent))}%` }} /></div>
                  <small>Margen estimado {marginPercent.toFixed(1)}%</small>
                </div>
              </div>

              <section className="inventory-detail-section">
                <div className="modal-section-header"><Package size={18} /><h3>Perfil del plato</h3></div>
                <div className="inventory-detail-profile-grid">
                  <div className="inventory-detail-profile-item"><Tag size={18} /><div><span>Categoría</span><strong>{viewingItem.category?.name ?? 'Sin categoría'}</strong></div></div>
                  <div className="inventory-detail-profile-item"><Building2 size={18} /><div><span>Sucursal</span><strong>{branchName}</strong></div></div>
                  <div className="inventory-detail-profile-item"><Layers size={18} /><div><span>Marca</span><strong>{viewingItem.brand?.name ?? 'Común'}</strong></div></div>
                  <div className="inventory-detail-profile-item"><ImageIcon size={18} /><div><span>Galería</span><strong>{viewingItem.images?.length ?? 0} imágenes</strong></div></div>
                </div>
              </section>

              <section className="inventory-detail-section">
                <div className="modal-section-header"><DollarSign size={18} /><h3>Precio, costo y margen</h3></div>
                <div className="inventory-detail-finance">
                  <div className="inventory-detail-effective-cost">
                    <div><span>Costo estimado de receta</span><strong>{formatMoney(totalCost)}</strong></div>
                    <span className="inventory-detail-cost-source">Calculado en servidor</span>
                  </div>
                  <dl className="inventory-detail-finance-breakdown">
                    <div><dt>Precio de venta</dt><dd>{formatMoney(price)}</dd></div>
                    <div><dt>Utilidad estimada</dt><dd>{formatMoney(margin)}</dd></div>
                    <div><dt>Margen</dt><dd>{marginPercent.toFixed(1)}%</dd></div>
                  </dl>
                  <p className="inventory-detail-finance-note">Los costos utilizan la receta y el costo efectivo vigente de cada insumo.</p>
                </div>
              </section>

              <section className="inventory-detail-section">
                <div className="modal-section-header"><Layers size={18} /><h3>Componentes de la receta</h3></div>
                {viewingItem.recipes?.length ? (
                  <div className="menu-detail-component-list">
                    {viewingItem.recipes.map((component, index) => {
                      const unit = component.unit || component.unitOfMeasure?.abbreviation || component.product.unit || '';
                      const referenceCost = effectiveUnitCost(component.product.currentAverageCost, component.product.cost);
                      return (
                        <article key={component.id} className="menu-detail-component">
                          <span className="menu-detail-component-index">{index + 1}</span>
                          <div><strong>{component.product.name}</strong><span>Insumo #{component.product.id}</span></div>
                          <div className="menu-detail-number"><span>Cantidad</span><strong>{Number(component.quantity).toLocaleString('es-NI', { maximumFractionDigits: 6 })} {unit}</strong></div>
                          <div className="menu-detail-number"><span>Costo unitario ref.</span><strong>{formatMoney(referenceCost)}</strong></div>
                        </article>
                      );
                    })}
                  </div>
                ) : <p className="inventory-detail-observation">Este plato no tiene componentes de receta registrados.</p>}
              </section>

              {viewingBranchPrices.length > 0 && (
                <section className="inventory-detail-section">
                  <div className="modal-section-header"><Building2 size={18} /><h3>Precios por sucursal</h3></div>
                  <div className="menu-detail-price-grid">
                    {viewingBranchPrices.map((row) => (
                      <div key={row.branchId}>
                        <span>{branches.find((branch) => branch.id === row.branchId)?.name ?? `Sucursal #${row.branchId}`}</span>
                        <strong>{formatMoney(Number(row.price))}</strong>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {Boolean(viewingItem.images?.length) && (
                <section className="inventory-detail-section">
                  <div className="modal-section-header"><ImageIcon size={18} /><h3>Galería</h3></div>
                  <div className="menu-detail-gallery">
                    {viewingItem.images?.map((image, index) => (
                      <button key={image.id} type="button" onClick={() => handleImageClick(viewingItem, index)} aria-label={`Abrir imagen ${index + 1} de ${viewingItem.name}`}>
                        <img src={image.imageUrl} alt={`${viewingItem.name} ${index + 1}`} />
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <section className="inventory-detail-section">
                <div className="modal-section-header"><Info size={18} /><h3>Descripción</h3></div>
                <p className="inventory-detail-observation">{viewingItem.description || 'Este plato no tiene descripción adicional.'}</p>
              </section>
            </div>
          );
        })()}
      </Sidebar>

      {/* REDESIGNED MODAL WITH TABS */}
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => { setIsSidebarOpen(false); setActiveTab('info'); }}
        title={editingItem ? 'Editar Plato' : 'Nuevo Plato'}
        width="normal"
      >
        <div className="premium-modal-content menu-item-modal-content">
          {/* NAVIGATION TABS */}
          <div className="modal-tabs" role="tablist" aria-label="Secciones del plato">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'info'}
              className={`modal-tab ${activeTab === 'info' ? 'active' : ''}`}
              onClick={() => setActiveTab('info')}
            >
              <Info size={18} />
              <span>Información</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'recipe'}
              className={`modal-tab ${activeTab === 'recipe' ? 'active' : ''}`}
              onClick={() => setActiveTab('recipe')}
            >
              <PieChart size={18} />
              <span>Costos</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'gallery'}
              className={`modal-tab ${activeTab === 'gallery' ? 'active' : ''}`}
              onClick={() => setActiveTab('gallery')}
            >
              <ImageIcon size={18} />
              <span>Galería</span>
            </button>
            {editingItem && (
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'pricing'}
                className={`modal-tab ${activeTab === 'pricing' ? 'active' : ''}`}
                onClick={() => setActiveTab('pricing')}
              >
                <DollarSign size={18} />
                <span>Precios</span>
              </button>
            )}
          </div>

          <form onSubmit={handleSubmit} className="modal-form-new">
            <div className="modal-tab-content">
              {/* 1. INFORMACIÓN TAB */}
              {activeTab === 'info' && (
                <div className="modal-content-group">
                  <div className="modal-section-header">
                    <Info size={18} />
                    <h3>Información del Plato</h3>
                  </div>

                  <div className="modal-input-group">
                    <label className="modal-input-label" htmlFor="menu-item-name">Nombre del Plato</label>
                    <input
                      id="menu-item-name"
                      autoFocus
                      className="modal-standard-input"
                      placeholder="Ej: Pasta Carbonara Premium"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      required
                      readOnly={!canMutateMenu}
                      disabled={!canMutateMenu}
                    />
                  </div>

                  <div className="modal-form-row">
                    <Select
                      variant="modal"
                      label="Categoría"
                      options={categories.filter(cat => isCategoryVisibleInMenu(cat) || cat.id.toString() === formData.categoryId).map(cat => ({ value: cat.id.toString(), label: cat.name }))}
                      value={categories.map(cat => ({ value: cat.id.toString(), label: cat.name })).find(opt => opt.value === formData.categoryId) || null}
                      onChange={(opt: SingleValue<StrOption>) => setFormData({ ...formData, categoryId: opt ? opt.value : '' })}
                      placeholder="Seleccionar..."
                      isClearable
                      isDisabled={!canMutateMenu}
                    />

                    <Select
                      variant="modal"
                      label="Sucursal"
                      options={[
                        { value: '', label: 'Todas las Sucursales (Global)' },
                        ...branches.map((b) => ({ value: b.id.toString(), label: b.name }))
                      ]}
                      value={formData.branchId
                        ? { value: formData.branchId, label: branches.find((b) => b.id.toString() === formData.branchId)?.name || '' }
                        : { value: '', label: 'Todas las Sucursales (Global)' }}
                      onChange={(opt: SingleValue<StrOption>) => setFormData({ ...formData, branchId: opt ? opt.value : '' })}
                      isDisabled={!canMutateMenu}
                    />

                    <Select
                      variant="modal"
                      label="Marca"
                      options={[
                        { value: '', label: 'Común (todas las marcas)' },
                        ...brands.filter(b => b.active || b.id.toString() === formData.brandId).map((b) => ({ value: b.id.toString(), label: b.name }))
                      ]}
                      value={formData.brandId
                        ? { value: formData.brandId, label: brands.find((b) => b.id.toString() === formData.brandId)?.name || '' }
                        : { value: '', label: 'Común (todas las marcas)' }}
                      onChange={(opt: SingleValue<StrOption>) => setFormData({ ...formData, brandId: opt ? opt.value : '' })}
                      isDisabled={!canMutateMenu}
                    />

                    <div className="modal-input-group">
                      <label className="modal-input-label" htmlFor="menu-item-price">Precio Final</label>
                      <div className="price-input-wrapper">
                        <span className="price-currency-icon">{symbol}</span>
                        <input
                          id="menu-item-price"
                          type="number"
                          step="0.01"
                          className="modal-standard-input"
                          style={{ paddingLeft: currencyInputPadding(symbol) }}
                          placeholder="0.00"
                          value={formData.price}
                          onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                          required
                          readOnly={!canMutateMenu}
                          disabled={!canMutateMenu}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="modal-input-group">
                    <label className="modal-input-label" htmlFor="menu-item-description">Descripción</label>
                    <textarea
                      id="menu-item-description"
                      className="modal-textarea"
                      style={{ minHeight: '100px' }}
                      placeholder="Detalles sobre sabores, ingredientes o preparación..."
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      readOnly={!canMutateMenu}
                      disabled={!canMutateMenu}
                    />
                  </div>
                </div>
              )}

              {/* 2. RECIPE & COSTOS TAB */}
              {activeTab === 'recipe' && (
                <div className="modal-content-group">
                  <div className="modal-section-header">
                    <PieChart size={18} />
                    <h3>Análisis de Costos y Receta</h3>
                  </div>

                  {/* Compact Stats Dashboard (Adapted) */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '24px' }}>
                    {(() => {
                      const totalCost = recipe.reduce((sum, ing) => sum + calculateIngredientLineCost(ing), 0);
                      const price = parseFloat(formData.price) || 0;
                      const profit = price - totalCost;
                      const margin = price > 0 ? (profit / price) * 100 : 0;

                      return (
                        <>
                          <div className="cost-stat-card primary">
                            <span className="cost-stat-label">Costo MP</span>
                            <div className="cost-stat-value">{formatMoney(totalCost)}</div>
                          </div>
                          <div className="cost-stat-card">
                            <span className="cost-stat-label">Margen</span>
                            <div className="cost-stat-value" style={{ color: margin >= 70 ? 'var(--color-success)' : margin >= 40 ? 'var(--color-warning)' : 'var(--color-danger)' }}>
                              {margin.toFixed(0)}%
                            </div>
                          </div>
                          <div className="cost-stat-card">
                            <span className="cost-stat-label">Utilidad</span>
                            <div className="cost-stat-value">{formatMoney(profit)}</div>
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  {/* Add Tool */}
                  <div className="modal-input-group">
                    <label className="modal-input-label" id="menu-ingredient-add-label">Incorporar Ingrediente</label>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }} role="group" aria-labelledby="menu-ingredient-add-label">
                      <div style={{ flex: 2, minWidth: '140px' }}>
                        <Select
                          variant="modal"
                          inputId="menu-ingredient-product"
                          options={products.map(p => ({
                            value: p.id.toString(), label: p.name, cost: p.cost, unit: p.unit
                          }))}
                          value={products
                            .map(p => ({ value: p.id.toString(), label: p.name }))
                            .find(opt => opt.value === selectedProductId) || null
                          }
                          onChange={(opt: SingleValue<StrOption>) => handleIngredientProductChange(opt ? opt.value : '')}
                          placeholder="Buscar..."
                          isClearable
                          isDisabled={!canMutateMenu}
                        />
                      </div>
                      <input
                        id="menu-ingredient-quantity"
                        type="number"
                        min="0.001"
                        step="0.001"
                        className="modal-standard-input"
                        style={{ width: '80px', textAlign: 'center' }}
                        placeholder="Cant"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        readOnly={!canMutateMenu}
                        disabled={!canMutateMenu}
                      />
                      {selectedProductId && (
                        <div style={{ minWidth: '120px' }}>
                          <Select
                            variant="modal"
                            inputId="menu-ingredient-unit"
                            options={ingredientUnits.map((u) => ({
                              value: u.abbreviation,
                              label: u.name && u.name !== u.abbreviation
                                ? `${u.name} (${u.abbreviation})`
                                : u.abbreviation
                            }))}
                            value={selectedIngredientUnit
                              ? {
                                  value: selectedIngredientUnit,
                                  label: (() => {
                                    const match = ingredientUnits.find(
                                      (u) => u.abbreviation === selectedIngredientUnit
                                    );
                                    return match?.name && match.name !== match.abbreviation
                                      ? `${match.name} (${match.abbreviation})`
                                      : selectedIngredientUnit;
                                  })()
                                }
                              : null}
                            onChange={(opt: SingleValue<StrOption>) => setSelectedIngredientUnit(opt?.value || '')}
                            isSearchable={ingredientUnits.length > 6}
                            isDisabled={!canMutateMenu || ingredientUnits.length === 0}
                            placeholder="Unidad"
                          />
                        </div>
                      )}
                      <Button
                        type="button"
                        variant="primary"
                        style={{ padding: '0 12px' }}
                        onClick={addIngredient}
                        disabled={!canMutateMenu || !selectedProductId || !quantity || Number(quantity) <= 0}
                      >
                        <Plus size={18} />
                      </Button>
                    </div>
                  </div>

                  {/* Ingredients Table (Adapted) */}
                  <div className="modal-input-group" style={{ marginTop: '16px' }}>
                    <label className="modal-input-label" id="menu-ingredients-list-label">Ingredientes Seleccionados</label>
                    <div id="menu-ingredients-list" aria-labelledby="menu-ingredients-list-label" style={{ border: '1px solid var(--color-border)', borderRadius: '8px', overflow: 'hidden' }}>
                      {recipe.length > 0 ? (
                        recipe.map((ing, i) => {
                          const allowedUnits = recipeUnitsByProduct[ing.productId] || [];
                          const unitOptions = allowedUnits.map((unit) => ({
                            value: unit.abbreviation,
                            label: unit.name && unit.name !== unit.abbreviation
                              ? `${unit.name} (${unit.abbreviation})`
                              : unit.abbreviation,
                          }));
                          const selectedUnitOption = unitOptions.find(
                            (option) => option.value.toLowerCase() === ing.unit.toLowerCase()
                          ) || { value: ing.unit, label: ing.unit };

                          return (
                            <div key={ing.id ?? `new-${ing.productId}`} className="recipe-ingredient-row">
                              <div className="recipe-ingredient-name">
                                <div>{ing.productName}</div>
                                {!ing.unitConfigured && (
                                  <span className="recipe-unit-error">Unidad no configurada</span>
                                )}
                              </div>
                              {canMutateMenu ? (
                                <>
                                  <input
                                    type="number"
                                    min="0.001"
                                    step="0.001"
                                    className="modal-standard-input recipe-ingredient-quantity"
                                    aria-label={`Cantidad de ${ing.productName}`}
                                    value={ing.quantity}
                                    onChange={(event) => updateIngredientQuantity(i, event.target.value)}
                                  />
                                  <div className="recipe-ingredient-unit">
                                    <Select
                                      variant="modal"
                                      options={unitOptions}
                                      value={selectedUnitOption}
                                      onChange={(option: SingleValue<StrOption>) => updateIngredientUnit(i, option?.value || '')}
                                      isSearchable={unitOptions.length > 6}
                                      isDisabled={unitOptions.length === 0}
                                      aria-label={`Unidad de ${ing.productName}`}
                                    />
                                  </div>
                                </>
                              ) : (
                                <span className="recipe-ingredient-measure">{ing.quantity} {ing.unit}</span>
                              )}
                              <div className="recipe-ingredient-cost">
                                {ing.unitConfigured
                                  ? formatMoney(calculateIngredientLineCost(ing))
                                  : '—'}
                              </div>
                              {canMutateMenu ? (
                                <button
                                  type="button"
                                  onClick={() => removeIngredient(i)}
                                  className="recipe-ingredient-remove"
                                  aria-label={`Quitar ${ing.productName}`}
                                >
                                  <Trash2 size={14} />
                                </button>
                              ) : null}
                            </div>
                          );
                        })
                      ) : (
                        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-neutral-400)', fontSize: '13px' }}>
                          Sin ingredientes registrados
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* 3. GALERÍA TAB */}
              {activeTab === 'gallery' && (
                <div className="modal-content-group">
                  <div className="modal-section-header">
                    <ImageIcon size={18} />
                    <h3>Galería de Imágenes</h3>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                    {images.map((img, i) => (
                      <div key={i} style={{ position: 'relative', aspectRatio: '1', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
                        <img src={img} alt="dish" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        {i === 0 && (
                          <span style={{ position: 'absolute', top: '4px', left: '4px', background: 'var(--color-primary)', color: 'white', fontSize: '10px', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>
                            Principal
                          </span>
                        )}
                        {canMutateMenu ? (
                          <button
                            type="button"
                            onClick={() => removeImage(i)}
                            style={{ position: 'absolute', top: '4px', right: '4px', background: 'rgba(239, 68, 68, 0.9)', color: 'white', border: 'none', padding: '4px', borderRadius: '4px', cursor: 'pointer' }}
                          >
                            <Trash2 size={12} />
                          </button>
                        ) : null}
                      </div>
                    ))}
                    {images.length < 3 && canMutateMenu && (
                      <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', aspectRatio: '1', borderRadius: '8px', border: '2px dashed var(--color-border)', cursor: 'pointer', color: 'var(--color-neutral-400)', transition: 'all 0.2s' }}>
                        <input
                          type="file"
                          accept=".png,.jpg,.jpeg,.gif,.webp"
                          multiple
                          onChange={handleImageUpload}
                          style={{ display: 'none' }}
                        />
                        <ImagePlus size={24} />
                        <span style={{ fontSize: '11px', fontWeight: 600, marginTop: '4px' }}>Cargar</span>
                      </label>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'pricing' && editingItem && (
                <div className="modal-content-group">
                  <div className="modal-section-header">
                    <DollarSign size={18} />
                    <h3>Matriz de precios por sucursal</h3>
                  </div>
                  <div className="branch-pricing-panel">
                    <div style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)', marginBottom: '12px' }}>
                      {formData.branchId
                        ? 'Este plato es exclusivo de una sucursal. Los precios de abajo permiten ajustes adicionales por local.'
                        : 'Este plato es global. Cada sucursal puede sobrescribir el precio base si lo necesita.'}
                    </div>
                    <div style={{ display: 'grid', gap: '8px' }}>
                      <div className="branch-pricing-row base-price">
                        <span>Precio base {formData.branchId ? '(sucursal propia)' : '(global)'}</span>
                        <strong>{formatMoney(Number(formData.price || 0))}</strong>
                      </div>
                      {branches.map((branch) => {
                        const existingPrice = branchPricing.find((priceRow) => priceRow.branchId === branch.id);
                        return (
                          <div key={branch.id} className="branch-pricing-row">
                            <div>
                              <div style={{ fontWeight: 600 }}>{branch.name}</div>
                              <div style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>
                                {branch.code ? `${branch.code} · ` : ''}
                                {existingPrice ? 'Override activo' : 'Usa precio base'}
                              </div>
                            </div>
                            <div className="price-input-wrapper branch-pricing-price-input">
                              <span className="price-currency-icon">{symbol}</span>
                              <input
                                type="number"
                                step="0.01"
                                className="modal-standard-input"
                                style={{ paddingLeft: currencyInputPadding(symbol), width: '100%' }}
                                value={branchPriceDrafts[branch.id] ?? (existingPrice ? Number(existingPrice.price).toFixed(2) : Number(formData.price || 0).toFixed(2))}
                                onChange={(e) => setBranchPriceDrafts((prev) => ({ ...prev, [branch.id]: e.target.value }))}
                                readOnly={!canSetBranchPrices}
                                disabled={!canSetBranchPrices}
                              />
                            </div>
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => handleSaveBranchPrice(branch.id)}
                              disabled={!canSetBranchPrices || savingBranchPriceId === branch.id}
                            >
                              {savingBranchPriceId === branch.id ? 'Guardando...' : 'Guardar'}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <Button type="button" variant="ghost" onClick={() => setIsSidebarOpen(false)}>
                {canMutateMenu ? 'Cancelar' : 'Cerrar'}
              </Button>
              {canMutateMenu && (
                <Button type="submit" variant="primary" disabled={!formData.name || saving}>
                  {saving ? 'Guardando...' : editingItem ? 'Actualizar Plato' : 'Guardar en Catálogo'}
                </Button>
              )}
            </div>
          </form >
        </div >
      </Sidebar >

      {/* MODIFIERS ADMIN MODAL */}
      <Sidebar
        isOpen={isModifierModalOpen}
        onClose={() => { setIsModifierModalOpen(false); resetModifierForm(); }}
        title="Modificadores"
        width="normal"
      >
        <div className="premium-modal-content modifiers-admin">
          <div className="modal-tab-content">
            {/* Group selector + create */}
            <div className="modal-section">
              <div className="modal-section-header">
                <SlidersHorizontal size={18} />
                <h3>Grupos de modificadores</h3>
              </div>

              <div className="modifier-group-chips">
                {modifierGroups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    className={`modifier-group-chip ${selectedGroupId === group.id ? 'active' : ''}`}
                    onClick={() => { setSelectedGroupId(group.id); resetModifierForm(); }}
                  >
                    {group.name}
                    <span className="modifier-group-chip-count">{group.modifiers.length}</span>
                  </button>
                ))}
                {modifierGroups.length === 0 && (
                  <span className="modifier-empty-hint">Aún no hay grupos. Crea uno para empezar.</span>
                )}
              </div>

              <div className="modifier-inline-add">
                <input
                  className="modal-standard-input"
                  placeholder="Nuevo grupo (ej: Extras, Tamaño)"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreateGroup(); } }}
                />
                <Button type="button" variant="secondary" onClick={handleCreateGroup} disabled={!newGroupName.trim()}>
                  <Plus size={16} /> Grupo
                </Button>
              </div>
            </div>

            {/* Modifiers of selected group */}
            {selectedGroupId && (
              <div className="modal-content-group">
                <div className="modal-section-header">
                  <Package size={18} />
                  <h3>Modificadores del grupo</h3>
                </div>

                <div className="modifier-list">
                  {(modifierGroups.find((g) => g.id === selectedGroupId)?.modifiers || []).map((modifier) => (
                    <div key={modifier.id} className="modifier-list-row">
                      <div className="modifier-list-main">
                        <span className="modifier-list-name">{modifier.name}</span>
                        <span className="modifier-list-price">+{formatMoney(Number(modifier.price))}</span>
                      </div>
                      <div className="modifier-list-link">
                        {modifier.productId ? (
                          <span className="modifier-link-tag">
                            <Package size={13} />
                            Consume {Number(modifier.consumeQuantity ?? 0)} {modifier.unit?.abbreviation || ''} de {modifier.product?.name || 'producto'}
                          </span>
                        ) : (
                          <span className="modifier-link-tag muted">Sin consumo de inventario</span>
                        )}
                      </div>
                      <div className="modifier-list-actions">
                        <button type="button" className="catalog-action-btn" title="Editar" onClick={() => handleEditModifier(modifier)}>
                          <Edit2 size={16} />
                        </button>
                        <button type="button" className="catalog-action-btn danger" title="Eliminar" onClick={() => handleDeleteModifier(modifier)}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {(modifierGroups.find((g) => g.id === selectedGroupId)?.modifiers.length ?? 0) === 0 && (
                    <span className="modifier-empty-hint">Este grupo no tiene modificadores.</span>
                  )}
                </div>

                {/* Add / edit modifier */}
                <div className="modifier-edit-card">
                  <div className="modifier-edit-title">
                    {editingModifierId ? 'Editar modificador' : 'Nuevo modificador'}
                  </div>

                  <div className="modal-form-row">
                    <div className="modal-input-group">
                      <label className="modal-input-label" htmlFor="modifier-name">Nombre</label>
                      <input
                        id="modifier-name"
                        className="modal-standard-input"
                        placeholder="Ej: Queso extra"
                        value={modifierForm.name}
                        onChange={(e) => setModifierForm({ ...modifierForm, name: e.target.value })}
                      />
                    </div>
                    <div className="modal-input-group">
                      <label className="modal-input-label" htmlFor="modifier-price">Precio extra</label>
                      <div className="price-input-wrapper">
                        <span className="price-currency-icon">{symbol}</span>
                        <input
                          id="modifier-price"
                          type="number"
                          step="0.01"
                          className="modal-standard-input"
                          style={{ paddingLeft: currencyInputPadding(symbol) }}
                          placeholder="0.00"
                          value={modifierForm.extraPrice}
                          onChange={(e) => setModifierForm({ ...modifierForm, extraPrice: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="modifier-link-divider">
                    <Package size={14} /> Consumo de inventario (opcional)
                  </div>

                  <div className="modal-form-row">
                    <Select
                      variant="modal"
                      label="Producto / insumo a consumir"
                      options={modifierProducts.map((p) => ({ value: String(p.id), label: p.sku ? `${p.name} (${p.sku})` : p.name }))}
                      value={modifierForm.productId
                        ? (() => {
                          const p = modifierProducts.find((mp) => String(mp.id) === modifierForm.productId);
                          return p ? { value: String(p.id), label: p.sku ? `${p.name} (${p.sku})` : p.name } : null;
                        })()
                        : null}
                      onChange={(opt: SingleValue<StrOption>) => setModifierForm({ ...modifierForm, productId: opt ? opt.value : '', ...(opt ? {} : { consumeQuantity: '', unitId: '' }) })}
                      placeholder="Sin vínculo de inventario"
                      isClearable
                    />
                    <div className="modal-input-group">
                      <label className="modal-input-label" htmlFor="modifier-qty">Cantidad a consumir</label>
                      <input
                        id="modifier-qty"
                        type="number"
                        step="0.001"
                        className="modal-standard-input"
                        placeholder="0.000"
                        value={modifierForm.consumeQuantity}
                        onChange={(e) => setModifierForm({ ...modifierForm, consumeQuantity: e.target.value })}
                        disabled={!modifierForm.productId}
                      />
                    </div>
                    <Select
                      variant="modal"
                      label="Unidad"
                      options={units.map((u) => ({ value: String(u.id), label: `${u.name} (${u.abbreviation})` }))}
                      value={modifierForm.unitId
                        ? (() => {
                          const u = units.find((mu) => String(mu.id) === modifierForm.unitId);
                          return u ? { value: String(u.id), label: `${u.name} (${u.abbreviation})` } : null;
                        })()
                        : null}
                      onChange={(opt: SingleValue<StrOption>) => setModifierForm({ ...modifierForm, unitId: opt ? opt.value : '' })}
                      placeholder="Unidad base del producto"
                      isClearable
                      isDisabled={!modifierForm.productId}
                    />
                  </div>

                  <div className="modifier-edit-actions">
                    {editingModifierId && (
                      <Button type="button" variant="ghost" onClick={resetModifierForm}>Cancelar edición</Button>
                    )}
                    <Button type="button" variant="primary" onClick={handleSaveModifier} disabled={savingModifier || !modifierForm.name.trim()}>
                      {savingModifier ? 'Guardando...' : editingModifierId ? 'Actualizar' : 'Agregar modificador'}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="modal-footer">
            <Button type="button" variant="ghost" onClick={() => { setIsModifierModalOpen(false); resetModifierForm(); }}>
              Cerrar
            </Button>
          </div>
        </div>
      </Sidebar>
    </div >
  );
}

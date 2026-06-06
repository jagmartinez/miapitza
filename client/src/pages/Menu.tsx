import { useState, useEffect, useCallback } from 'react';
import Select from '../components/Select';
import { branchPricingAPI, menuAPI, productsAPI, categoriesAPI, branchesAPI, unitsAPI, menuBrandsAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { hasAnyRole } from '../utils/authz';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
import {
  Plus, Utensils, Trash2, Image as ImageIcon,
  Info, PieChart, ImagePlus, DollarSign, Edit2
} from 'lucide-react';
import ViewToggle from '../components/ViewToggle';
import CatalogTable, { type CatalogColumn } from '../components/CatalogTable';
import { useViewMode } from '../hooks/useViewMode';
import { currencyInputPadding } from '../utils/currency';
import type { Branch, MenuItem, MenuBrand, Product, ProductAllowedUnit } from '../types';
import type { SingleValue } from 'react-select';

type CatFilterOption = { value: string; label: string };
import MenuItemCard from '../components/MenuItemCard';
import { useCurrency } from '../hooks/useCurrency';
import ImageViewer from '../components/ImageViewer';
import './Menu.css';

interface RecipeIngredient {
  productId: number;
  productName: string;
  quantity: number;
  unit: string;
  cost: number;
  conversionFactor: number;
}

interface CategoryRow {
  id: number;
  name: string;
  active?: boolean;
  showInMenu?: boolean;
}

interface BranchPriceRow {
  branchId: number;
  price: number | string;
}

interface RecipeApiRow {
  id: number;
  quantity: string | number;
  unit?: string;
  product: Product;
}

interface MenuImageRecord {
  id: number;
  imageUrl: string;
}

type StrOption = { value: string; label: string };

export default function Menu() {
  const { user } = useAuth();
  const { formatMoney, symbol } = useCurrency();
  const { confirm } = useConfirmDialog();
  const { error: showError, warning: showWarning } = useAppToast();
  /** Backend: menu/recipe/image mutations require SUPERADMIN | ADMIN */
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

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    categoryId: '',
    branchId: '',
    brandId: ''
  });

  const [recipe, setRecipe] = useState<RecipeIngredient[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [selectedIngredientUnit, setSelectedIngredientUnit] = useState<string>('');
  const [ingredientUnits, setIngredientUnits] = useState<ProductAllowedUnit[]>([]);
  const [quantity, setQuantity] = useState<string>('');
  const [images, setImages] = useState<string[]>([]);
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

  const calculateIngredientLineCost = (ingredient: RecipeIngredient) => {
    const baseQuantity = Number(ingredient.quantity) * Number(ingredient.conversionFactor || 1);
    return Number(ingredient.cost) * baseQuantity;
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [menuRes, productsRes, categoriesRes, branchesRes, brandsRes] = await Promise.all([
        menuAPI.getAll({ active: true }),
        productsAPI.getAll({ active: true }),
        categoriesAPI.getAll(),
        branchesAPI.getAll(),
        menuBrandsAPI.getAll()
      ]);
      setMenuItems(menuRes.data.data);
      setBranches(branchesRes.data.data || []);
      setBrands(brandsRes.data.data || []);
      setProducts(productsRes.data.data.filter((p: Product) =>
        p.type === 'INGREDIENT' || p.type === 'BOTH'
      ));
      setCategories(categoriesRes.data.data);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
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

      try {
        const [recipesRes, imagesRes] = await Promise.all([
          menuAPI.getRecipes(item.id),
          menuAPI.getImages(item.id)
        ]);

        const recipeRows: RecipeApiRow[] = recipesRes.data.data || [];
        const uniqueProductIds = Array.from(new Set(recipeRows.map((r) => r.product.id)));
        const productUnitsMap = new Map<number, ProductAllowedUnit[]>();

        await Promise.all(uniqueProductIds.map(async (productId) => {
          try {
            const unitsRes = await unitsAPI.getProductUnits(productId);
            productUnitsMap.set(productId, unitsRes.data.data || []);
          } catch {
            productUnitsMap.set(productId, []);
          }
        }));

        const loadedRecipes = recipeRows.map((r: RecipeApiRow) => {
          const recipeUnit = r.unit || r.product.unit;
          const allowedUnits = productUnitsMap.get(r.product.id) || [];
          const matchedUnit = allowedUnits.find(
            (u) => u.abbreviation.toLowerCase() === String(recipeUnit).toLowerCase()
          );
          return {
            productId: r.product.id,
            productName: r.product.name,
            quantity: Number(r.quantity),
            unit: recipeUnit,
            cost: Number(r.product.cost),
            conversionFactor: Number(matchedUnit?.conversionFactor || 1)
          };
        });

        const loadedImages = imagesRes.data.data.map((img: MenuImageRecord) => img.imageUrl);

        setRecipe(loadedRecipes);
        setImages(loadedImages);
        const pricingRes = await branchPricingAPI.getMenuItemMatrix(item.id);
        setBranchPricing(pricingRes.data.data.branchPrices || []);
        setBranchPriceDrafts(
          (pricingRes.data.data.branchPrices || []).reduce((acc: Record<number, string>, priceRow: BranchPriceRow) => {
            acc[priceRow.branchId] = Number(priceRow.price).toFixed(2);
            return acc;
          }, {})
        );
      } catch (error) {
        console.error('Error loading details:', error);
      }
    } else {
      setEditingItem(null);
      setFormData({ name: '', description: '', price: '', categoryId: '', branchId: '', brandId: '' });
      setRecipe([]);
      setImages([]);
      setBranchPricing([]);
      setBranchPriceDrafts({});
    }
    setIsSidebarOpen(true);
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
      const units: ProductAllowedUnit[] = res.data.data || [];
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
      const baseUnit = product?.unit || 'unidad';
      setIngredientUnits([{ unitId: 0, abbreviation: baseUnit, name: baseUnit, conversionFactor: 1, isBase: true, isDefault: true }]);
      setSelectedIngredientUnit(baseUnit);
    }
  }, [products]);

  const addIngredient = () => {
    if (!selectedProductId || !quantity) return;

    const product = products.find(p => p.id === parseInt(selectedProductId));
    if (!product) return;

    const newIngredient: RecipeIngredient = {
      productId: product.id,
      productName: product.name,
      quantity: parseFloat(quantity),
      unit: selectedIngredientUnit || product.unit,
      cost: Number(product.cost),
      conversionFactor: Number(
        ingredientUnits.find(
          (u) => u.abbreviation.toLowerCase() === String(selectedIngredientUnit || product.unit).toLowerCase()
        )?.conversionFactor || 1
      )
    };

    setRecipe([...recipe, newIngredient]);
    setSelectedProductId('');
    setSelectedIngredientUnit('');
    setIngredientUnits([]);
    setQuantity('');
  };

  const removeIngredient = (index: number) => {
    setRecipe(recipe.filter((_, i) => i !== index));
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
    setSaving(true);
    try {
      const menuData = {
        name: formData.name,
        description: formData.description || undefined,
        price: parseFloat(formData.price),
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

        const [existingRecipes, existingImages] = await Promise.all([
          menuAPI.getRecipes(menuItemId),
          menuAPI.getImages(menuItemId)
        ]);

        await Promise.all([
          ...existingRecipes.data.data.map((r: { id: number }) => menuAPI.deleteRecipe(r.id)),
          ...existingImages.data.data.map((img: MenuImageRecord) => menuAPI.deleteImage(img.id))
        ]);
      } else {
        const response = await menuAPI.create(menuData);
        menuItemId = response.data.data.id;
      }

      if (recipe.length > 0) {
        await Promise.all(recipe.map(ing =>
          menuAPI.addRecipe(menuItemId, {
            productId: ing.productId,
            quantity: ing.quantity,
            unit: ing.unit
          })
        ));
      }

      if (images.length > 0) {
        await Promise.all(images.map(img =>
          menuAPI.addImage(menuItemId, img)
        ));
      }

      setIsSidebarOpen(false);
      loadData();
    } catch (error: unknown) {
      console.error('Error saving menu item:', error);
      showError('Error al guardar el plato');
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

  const handleImageClick = (item: MenuItem, index: number) => {
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
              ...categories.filter(cat => cat.active && cat.showInMenu !== false).map(cat => ({ value: cat.name, label: cat.name }))
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
                    onClick={() => handleOpenSidebar(item)}
                    title="Ver / Editar"
                  >
                    <Edit2 size={16} />
                  </button>
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
              onClick={() => handleOpenSidebar(item)}
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

      {/* REDESIGNED MODAL WITH TABS */}
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => { setIsSidebarOpen(false); setActiveTab('info'); }}
        title={editingItem ? 'Editar Plato' : 'Nuevo Plato'}
        width="normal"
      >
        <div className="premium-modal-content menu-item-modal-content">
          {/* NAVIGATION TABS */}
          <div className="modal-tabs">
            <button
              type="button"
              className={`modal-tab ${activeTab === 'info' ? 'active' : ''}`}
              onClick={() => setActiveTab('info')}
            >
              <Info size={18} />
              <span>Información</span>
            </button>
            <button
              type="button"
              className={`modal-tab ${activeTab === 'recipe' ? 'active' : ''}`}
              onClick={() => setActiveTab('recipe')}
            >
              <PieChart size={18} />
              <span>Costos</span>
            </button>
            <button
              type="button"
              className={`modal-tab ${activeTab === 'gallery' ? 'active' : ''}`}
              onClick={() => setActiveTab('gallery')}
            >
              <ImageIcon size={18} />
              <span>Galería</span>
            </button>
            {editingItem && (
              <button
                type="button"
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
                <div className="modal-section animate-slide-in">
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
                      options={categories.filter(cat => (cat.active && cat.showInMenu !== false) || cat.id.toString() === formData.categoryId).map(cat => ({ value: cat.id.toString(), label: cat.name }))}
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
                <div className="modal-section animate-slide-in">
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
                        disabled={!canMutateMenu || !selectedProductId || !quantity}
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
                        recipe.map((ing, i) => (
                          <div key={i} className="recipe-ingredient-row">
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '13px', fontWeight: 600 }}>{ing.productName}</div>
                              <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{ing.quantity} {ing.unit}</div>
                            </div>
                            <div style={{ fontWeight: 600, fontSize: '13px', marginRight: '16px' }}>
                              {formatMoney(calculateIngredientLineCost(ing))}
                            </div>
                            {canMutateMenu ? (
                              <button type="button" onClick={() => removeIngredient(i)} style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', padding: '4px' }}>
                                <Trash2 size={14} />
                              </button>
                            ) : null}
                          </div>
                        ))
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
                <div className="modal-section animate-slide-in">
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
                <div className="modal-section animate-slide-in">
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
    </div >
  );
}

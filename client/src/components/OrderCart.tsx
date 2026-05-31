import { useState, useEffect } from 'react';
import { Plus, Minus, Trash2, Tag } from 'lucide-react';
import { useConfirmDialog } from '../context/ConfirmContext';
import { promotionsAPI } from '../services/api';
import type { MenuItem } from '../types';
import './OrderCart.css';

interface CartItem {
    menuItemId: number;
    menuItem: MenuItem;
    quantity: number;
    price: number;
    notes: string;
}

interface OrderCartProps {
    cart: CartItem[];
    discount: number;
    taxRate: number;
    onUpdateQuantity: (menuItemId: number, delta: number) => void;
    onRemoveItem: (menuItemId: number) => void;
    onDiscountChange: (discount: number) => void;
    enablePromotions?: boolean;
    onApplyPromotion?: (code: string) => void;
    currencySymbol?: string;
}

export default function OrderCart({
    cart,
    discount,
    taxRate,
    onUpdateQuantity,
    onRemoveItem,
    onDiscountChange,
    enablePromotions,
    onApplyPromotion,
    currencySymbol = '$'
}: OrderCartProps) {
    const { confirm } = useConfirmDialog();

    const handleRemove = async (itemId: number) => {
        if (!(await confirm('¿Eliminar este producto del carrito?', { variant: 'warning' }))) return;
        onRemoveItem(itemId);
    };

    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const discountAmount = subtotal * (discount / 100);
    const tax = (subtotal - discountAmount) * (taxRate / 100);
    const total = subtotal - discountAmount + tax;

    return (
        <div className="order-cart">
            <div className="cart-header">
                <h3>Orden Actual</h3>
                <span className="item-count">{cart.length} items</span>
            </div>

            <div className="cart-items-list">
                {cart.length === 0 ? (
                    <div className="empty-cart-message">
                        <p>Sin productos</p>
                        <small>Selecciona items del menú</small>
                    </div>
                ) : (
                    cart.map(item => (
                        <div key={item.menuItemId} className="cart-item-compact">
                            <div className="item-info">
                                <div className="item-name-compact">{item.menuItem.name}</div>
                                <div className="item-price-compact">{currencySymbol}{Number(item.price).toFixed(2)}</div>
                            </div>
                            <div className="item-actions">
                                <button
                                    className="qty-btn-compact"
                                    onClick={() => onUpdateQuantity(item.menuItemId, -1)}
                                >
                                    <Minus size={14} />
                                </button>
                                <span className="qty-display">{item.quantity}</span>
                                <button
                                    className="qty-btn-compact"
                                    onClick={() => onUpdateQuantity(item.menuItemId, 1)}
                                >
                                    <Plus size={14} />
                                </button>
                                <button
                                    className="remove-btn-compact"
                                    onClick={() => void handleRemove(item.menuItemId)}
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                            <div className="item-total-compact">
                                {currencySymbol}{(Number(item.price) * item.quantity).toFixed(2)}
                            </div>
                        </div>
                    ))
                )}
            </div>

            <div className="cart-footer">
                <div className="discount-control">
                    <label>Descuento %</label>
                    <input
                        type="number"
                        min="0"
                        max="100"
                        value={discount}
                        onChange={(e) => onDiscountChange(Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))}
                        className="discount-input-compact"
                    />
                </div>

                {enablePromotions && (
                    <PromotionSelector
                        onApply={onApplyPromotion}
                        currencySymbol={currencySymbol}
                    />
                )}

                <div className="totals-section">
                    <div className="total-line">
                        <span>Subtotal:</span>
                        <span>{currencySymbol}{subtotal.toFixed(2)}</span>
                    </div>
                    {discount > 0 && (
                        <div className="total-line discount-line">
                            <span>Descuento ({discount}%):</span>
                            <span>-{currencySymbol}{discountAmount.toFixed(2)}</span>
                        </div>
                    )}
                    <div className="total-line">
                        <span>IVA ({taxRate}%):</span>
                        <span>{currencySymbol}{tax.toFixed(2)}</span>
                    </div>
                    <div className="total-line total-final">
                        <span>TOTAL:</span>
                        <span>{currencySymbol}{total.toFixed(2)}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

interface PromotionListEntry {
    id: number;
    code: string;
    name: string;
    type: string;
    value: number;
}

/** Inline promotion selector with active promos dropdown */
function PromotionSelector({ onApply, currencySymbol = '$' }: { onApply?: (code: string) => void; currencySymbol?: string }) {
    const [promos, setPromos] = useState<PromotionListEntry[]>([]);
    const [selected, setSelected] = useState('');
    const [manualCode, setManualCode] = useState('');
    const [mode, setMode] = useState<'select' | 'manual'>('select');
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setLoadError(false);
        promotionsAPI.getAll(true).then(res => {
            if (cancelled) return;
            setPromos(res.data.data || []);
        }).catch(() => {
            if (cancelled) return;
            setLoadError(true);
        }).finally(() => {
            if (!cancelled) setLoading(false);
        });
        return () => { cancelled = true; };
    }, []);

    const handleApply = () => {
        const code = mode === 'select' ? selected : manualCode.toUpperCase();
        if (code && onApply) {
            onApply(code);
        }
    };

    return (
        <div className="promo-selector">
            <div className="promo-selector-header">
                <Tag size={14} />
                <span>Promoción</span>
                <div className="promo-mode-toggle">
                    <button type="button" className={mode === 'select' ? 'active' : ''} onClick={() => setMode('select')}>Lista</button>
                    <button type="button" className={mode === 'manual' ? 'active' : ''} onClick={() => setMode('manual')}>Código</button>
                </div>
            </div>

            {loadError && (
                <div style={{ fontSize: '0.78rem', color: 'var(--color-error, #ef4444)', margin: '4px 0' }}>
                    No se pudieron cargar las promociones. Usa un código manual.
                </div>
            )}
            {!loadError && !loading && promos.length === 0 && (
                <div style={{ fontSize: '0.78rem', color: 'var(--color-neutral-500)', margin: '4px 0' }}>
                    No hay promociones activas disponibles.
                </div>
            )}

            {mode === 'select' ? (
                <select
                    className="promo-select"
                    value={selected}
                    onChange={e => setSelected(e.target.value)}
                    disabled={loading || loadError || promos.length === 0}
                >
                    <option value="">{loading ? 'Cargando promociones...' : 'Seleccionar promoción...'}</option>
                    {promos.map(p => (
                        <option key={p.id} value={p.code}>
                            {p.code} — {p.name} ({p.type === 'PERCENTAGE' ? `${Number(p.value)}%` : `${currencySymbol}${Number(p.value)}`})
                        </option>
                    ))}
                </select>
            ) : (
                <input
                    type="text"
                    className="promo-manual-input"
                    placeholder="Ingresar código..."
                    value={manualCode}
                    onChange={e => setManualCode(e.target.value.toUpperCase())}
                    onKeyDown={e => { if (e.key === 'Enter') handleApply(); }}
                />
            )}

            <button
                type="button"
                className="promo-apply-btn"
                onClick={handleApply}
                disabled={mode === 'select' ? !selected : !manualCode}
            >
                Aplicar
            </button>
        </div>
    );
}

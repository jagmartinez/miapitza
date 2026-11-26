import { useState, useEffect, type ReactNode } from 'react';
import { Plus, Minus, Trash2, Tag } from 'lucide-react';
import { useConfirmDialog } from '../context/ConfirmContext';
import { promotionsAPI } from '../services/api';
import { AppSelect } from '@/ui';
import type { MenuItem } from '../types';
import { describePromotionSchedule, describePromotionValue, type PromotionRulesView } from '../utils/promotionRules';
import './OrderCart.css';

interface SelectedModifier {
    id: number;
    name: string;
    price: number;
}

interface CartItem {
    lineId: string;
    menuItemId: number;
    menuItem: MenuItem;
    quantity: number;
    price: number;
    notes: string;
    modifiers: SelectedModifier[];
}

interface OrderCartProps {
    cart: CartItem[];
    discount: number;
    taxRate: number;
    tipRate?: number;
    tipEnabled?: boolean;
    onUpdateQuantity: (lineId: string, delta: number) => void;
    onRemoveItem: (lineId: string) => void;
    onDiscountChange: (discount: number) => void;
    onTipToggle?: (enabled: boolean) => void;
    enablePromotions?: boolean;
    onApplyPromotion?: (code: string) => void;
    /** Branch of the order: only promotions valid there (and inside their happy hour) are listed. */
    promotionBranchId?: number | null;
    formatMoney: (amount: unknown) => string;
    /** Oculta el encabezado propio cuando el contenedor ya muestra el título de la orden. */
    hideHeader?: boolean;
    /** Acciones al pie del ticket, debajo del total (p. ej. Enviar a cocina / Cobrar). */
    footerActions?: ReactNode;
}

export default function OrderCart({
    cart,
    discount,
    taxRate,
    tipRate = 0,
    tipEnabled = false,
    onUpdateQuantity,
    onRemoveItem,
    onDiscountChange,
    onTipToggle,
    enablePromotions,
    onApplyPromotion,
    promotionBranchId,
    formatMoney,
    hideHeader = false,
    footerActions,
}: OrderCartProps) {
    const { confirm } = useConfirmDialog();

    const handleRemove = async (lineId: string) => {
        if (!(await confirm('¿Eliminar este producto del carrito?', { variant: 'warning' }))) return;
        onRemoveItem(lineId);
    };

    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const discountAmount = subtotal * (discount / 100);
    const tax = (subtotal - discountAmount) * (taxRate / 100);
    const tipAmount = tipEnabled ? (subtotal - discountAmount) * (tipRate / 100) : 0;
    const total = subtotal - discountAmount + tax + tipAmount;

    return (
        <div className="order-cart">
            {!hideHeader && (
                <div className="cart-header">
                    <h3>Orden Actual</h3>
                    <span className="item-count">{cart.length} items</span>
                </div>
            )}

            <div
                className="cart-items-list"
                role="region"
                aria-label="Productos de la orden"
                tabIndex={0}
            >
                {cart.length === 0 ? (
                    <div className="empty-cart-message">
                        <p>Sin productos</p>
                        <small>Selecciona items del menú</small>
                    </div>
                ) : (
                    cart.map(item => (
                        <div key={item.lineId} className="cart-item-compact">
                            <div className="item-info">
                                <div className="item-name-compact">{item.menuItem.name}</div>
                                <div className="item-price-compact">{formatMoney(Number(item.price))}</div>
                                {item.modifiers.length > 0 && (
                                    <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                        {item.modifiers.map(mod => (
                                            <li
                                                key={mod.id}
                                                style={{
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    gap: '8px',
                                                    fontSize: '0.78rem',
                                                    color: 'var(--ui-text-muted)'
                                                }}
                                            >
                                                <span>+ {mod.name}</span>
                                                {Number(mod.price) > 0 && (
                                                    <span>{formatMoney(Number(mod.price))}</span>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                            <div className="item-actions">
                                <button
                                    className="qty-btn-compact"
                                    onClick={() => onUpdateQuantity(item.lineId, -1)}
                                >
                                    <Minus size={14} />
                                </button>
                                <span className="qty-display">{item.quantity}</span>
                                <button
                                    className="qty-btn-compact"
                                    onClick={() => onUpdateQuantity(item.lineId, 1)}
                                >
                                    <Plus size={14} />
                                </button>
                                <button
                                    className="remove-btn-compact"
                                    onClick={() => void handleRemove(item.lineId)}
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                            <div className="item-total-compact">
                                {formatMoney(Number(item.price) * item.quantity)}
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
                        branchId={promotionBranchId}
                        formatMoney={formatMoney}
                    />
                )}

                <div className="totals-section">
                    <div className="total-line">
                        <span>Subtotal:</span>
                        <span>{formatMoney(subtotal)}</span>
                    </div>
                    {discount > 0 && (
                        <div className="total-line discount-line">
                            <span>Descuento ({discount}%):</span>
                            <span>-{formatMoney(discountAmount)}</span>
                        </div>
                    )}
                    <div className="total-line">
                        <span>IVA ({taxRate}%):</span>
                        <span>{formatMoney(tax)}</span>
                    </div>
                    {tipRate > 0 && onTipToggle && (
                        <div className="total-line tip-line">
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={tipEnabled}
                                    onChange={(e) => onTipToggle(e.target.checked)}
                                    style={{ accentColor: 'var(--ui-primary)' }}
                                />
                                <span>Propina ({tipRate}%):</span>
                            </label>
                            <span>{formatMoney(tipAmount)}</span>
                        </div>
                    )}
                    <div className="total-line total-final">
                        <span>TOTAL:</span>
                        <span>{formatMoney(total)}</span>
                    </div>
                </div>
                {footerActions}
            </div>
        </div>
    );
}

interface PromotionListEntry extends PromotionRulesView {
    id: number;
    code: string;
    name: string;
}

function promotionOptionLabel(p: PromotionListEntry, formatMoney: (amount: unknown) => string): string {
    const schedule = describePromotionSchedule(p);
    return `${p.code} — ${p.name} (${describePromotionValue(p, formatMoney)}${schedule ? ` · ${schedule}` : ''})`;
}

/** Inline promotion selector with active promos dropdown (only those valid for the order's branch, right now). */
function PromotionSelector({ onApply, formatMoney, branchId }: { onApply?: (code: string) => void; formatMoney: (amount: unknown) => string; branchId?: number | null }) {
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
        promotionsAPI.getAll(true, { branchId, availableNow: true }).then(res => {
            if (cancelled) return;
            setPromos(res.data.data || []);
        }).catch(() => {
            if (cancelled) return;
            setLoadError(true);
        }).finally(() => {
            if (!cancelled) setLoading(false);
        });
        return () => { cancelled = true; };
    }, [branchId]);

    const promoOptions = [
        ...promos.map((p) => ({
            value: p.code,
            label: promotionOptionLabel(p, formatMoney),
        })),
        // Keep a selected code visible even when it is no longer in the promotions list.
        ...(selected && !promos.some((p) => p.code === selected) ? [{ value: selected, label: selected }] : []),
    ];

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
                <div style={{ fontSize: '0.78rem', color: 'var(--ui-danger, #ef4444)', margin: '4px 0' }}>
                    No se pudieron cargar las promociones. Usa un código manual.
                </div>
            )}
            {!loadError && !loading && promos.length === 0 && (
                <div style={{ fontSize: '0.78rem', color: 'var(--ui-text-muted)', margin: '4px 0' }}>
                    No hay promociones activas disponibles.
                </div>
            )}

            {mode === 'select' ? (
                <AppSelect
                    inputId="cart-promo-select"
                    aria-label="Promoción"
                    value={selected || null}
                    onChange={(option) => setSelected(option || '')}
                    options={promoOptions}
                    placeholder={loading ? 'Cargando promociones...' : 'Seleccionar promoción...'}
                    isDisabled={loading || loadError || promos.length === 0}
                />
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

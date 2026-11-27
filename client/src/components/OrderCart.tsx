import { useState, useEffect, type ReactNode } from 'react';
import { Plus, Minus, Trash2, Tag } from 'lucide-react';
import { useConfirmDialog } from '../context/ConfirmContext';
import { promotionsAPI } from '../services/api';
import {
    AppSelect, Button, Checkbox, EmptyState, IconButton, Input, NumberInput, SegmentedControl, formatNumber,
} from '@/ui';
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
                    <span className="item-count">{formatNumber(cart.length, 0)} items</span>
                </div>
            )}

            <div
                className="cart-items-list"
                role="region"
                aria-label="Productos de la orden"
                tabIndex={0}
            >
                {cart.length === 0 ? (
                    <EmptyState title="Sin productos" description="Selecciona items del menú" />
                ) : (
                    cart.map(item => (
                        <div key={item.lineId} className="cart-item-compact">
                            <div className="item-info">
                                <div className="item-name-compact">{item.menuItem.name}</div>
                                <div className="item-price-compact">{formatMoney(Number(item.price))}</div>
                                {item.modifiers.length > 0 && (
                                    <ul className="cart-item-modifiers">
                                        {item.modifiers.map(mod => (
                                            <li key={mod.id}>
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
                                <IconButton
                                    icon={Minus}
                                    label={`Quitar una unidad de ${item.menuItem.name}`}
                                    tooltip="Quitar uno"
                                    onClick={() => onUpdateQuantity(item.lineId, -1)}
                                />
                                <span className="qty-display">{formatNumber(item.quantity, 0)}</span>
                                <IconButton
                                    icon={Plus}
                                    label={`Agregar una unidad de ${item.menuItem.name}`}
                                    tooltip="Agregar uno"
                                    onClick={() => onUpdateQuantity(item.lineId, 1)}
                                />
                                <span className="item-actions__spacer" />
                                <IconButton
                                    icon={Trash2}
                                    tone="danger"
                                    label={`Eliminar ${item.menuItem.name}`}
                                    tooltip="Eliminar"
                                    onClick={() => void handleRemove(item.lineId)}
                                />
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
                    <label htmlFor="cart-discount">Descuento</label>
                    <NumberInput
                        id="cart-discount"
                        decimals={2}
                        min={0}
                        suffix="%"
                        value={discount}
                        onChange={(value) => onDiscountChange(Math.min(100, Math.max(0, value ?? 0)))}
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
                            <span>Descuento ({formatNumber(discount)}%):</span>
                            <span>-{formatMoney(discountAmount)}</span>
                        </div>
                    )}
                    <div className="total-line">
                        <span>IVA ({formatNumber(taxRate)}%):</span>
                        <span>{formatMoney(tax)}</span>
                    </div>
                    {tipRate > 0 && onTipToggle && (
                        <div className="total-line tip-line">
                            <Checkbox
                                checked={tipEnabled}
                                onChange={(e) => onTipToggle(e.target.checked)}
                                label={`Propina (${formatNumber(tipRate)}%):`}
                            />
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
                <Tag size={14} aria-hidden="true" />
                <span>Promoción</span>
                <SegmentedControl<'select' | 'manual'>
                    ariaLabel="Forma de elegir la promoción"
                    size="sm"
                    value={mode}
                    onChange={setMode}
                    options={[
                        { value: 'select', label: 'Lista' },
                        { value: 'manual', label: 'Código' },
                    ]}
                />
            </div>

            {loadError && (
                <p className="promo-note promo-note--error" role="alert">
                    No se pudieron cargar las promociones. Usa un código manual.
                </p>
            )}
            {!loadError && !loading && promos.length === 0 && (
                <p className="promo-note">
                    No hay promociones activas disponibles.
                </p>
            )}

            <div className="promo-selector-row">
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
                    <Input
                        aria-label="Código de promoción"
                        className="promo-manual-input"
                        placeholder="Ingresar código..."
                        value={manualCode}
                        onChange={e => setManualCode(e.target.value.toUpperCase())}
                        onKeyDown={e => { if (e.key === 'Enter') handleApply(); }}
                    />
                )}

                <Button
                    type="button"
                    onClick={handleApply}
                    disabled={mode === 'select' ? !selected : !manualCode}
                >
                    Aplicar
                </Button>
            </div>
        </div>
    );
}

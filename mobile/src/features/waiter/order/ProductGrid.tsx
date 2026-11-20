import { useRef } from 'react';
import { money, type Product } from './orderModel';

const HOLD_MS = 500;

export interface ProductGridProps {
    products: Product[];
    /** Units of each product already in the ticket (draft plus order). */
    quantities: Map<number, number>;
    promos: Map<number, string>;
    disabled?: boolean;
    onTap: (product: Product) => void;
    /** Press and hold: note / modifiers. */
    onHold: (product: Product) => void;
}

function ProductTile({ product, qty, promo, disabled, onTap, onHold }: { product: Product; qty: number; promo?: string; disabled?: boolean; onTap: () => void; onHold: () => void }) {
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const fired = useRef(false);
    const clear = () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
    };
    const fireHold = () => {
        clear();
        fired.current = true;
        onHold();
    };
    return (
        <button
            type="button"
            className="product"
            data-product-id={product.id}
            data-in-ticket={qty > 0 ? 'true' : undefined}
            disabled={disabled}
            onPointerDown={() => {
                fired.current = false;
                clear();
                timer.current = setTimeout(fireHold, HOLD_MS);
            }}
            onPointerUp={clear}
            onPointerLeave={clear}
            onPointerCancel={clear}
            // Android WebView raises contextmenu on a long press: it is our hold, never the system menu.
            onContextMenu={(e) => {
                e.preventDefault();
                if (!fired.current) fireHold();
            }}
            onClick={() => {
                if (fired.current) {
                    fired.current = false; // the release that ends a hold is not a tap
                    return;
                }
                onTap();
            }}
        >
            <span className="product-name">{product.name}</span>
            <span className="product-foot">
                <span className="product-price">{money(product.price)}</span>
                {promo && <span className="product-promo">{promo}</span>}
                {qty > 0 && <span className="product-qty">{`×${qty}`}</span>}
            </span>
        </button>
    );
}

export function ProductGrid({ products, quantities, promos, disabled, onTap, onHold }: ProductGridProps) {
    return (
        <section className="products" aria-label="Productos">
            {products.length === 0 && <p className="muted products-empty">Sin productos.</p>}
            {products.map((p) => (
                <ProductTile key={p.id} product={p} qty={quantities.get(p.id) ?? 0} promo={promos.get(p.id)} disabled={disabled} onTap={() => onTap(p)} onHold={() => onHold(p)} />
            ))}
        </section>
    );
}

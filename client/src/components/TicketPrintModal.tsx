import React, { useState, useEffect, useCallback } from 'react';
import { AppSelect, Button, Field, FullScreenModal, LoadErrorState, Spinner, formatNumber } from '@/ui';
import api from '../services/api';
import { Printer } from 'lucide-react';
import { escapeHtml } from '../utils/escapeHtml';
import { resolveAssetUrl } from '../utils/assets';
import '../index.css';
import './TicketPrintModal.css';

interface CustomerTicketData {
  header: {
    logoUrl?: string;
    businessName: string;
    ruc?: string;
    address?: string;
    phone?: string;
    currency_symbol?: string;
  };
  order: {
    financialStatus: 'UNPAID' | 'PARTIAL' | 'PAID';
    number: string;
    date: string;
    table: string;
    waiter: string;
    customerName?: string;
  };
  items: Array<{
    quantity: number;
    name: string;
    price: number;
    subtotal: number;
    modifiers: Array<{ name: string }>;
  }>;
  totals: {
    subtotal: number;
    tax: number;
    discount: number;
    discountCode?: string;
    tip: number;
    total: number;
  };
  payments?: Array<{ method: string; amount: number }>;
  footer: { message: string };
}

interface KitchenTicketData {
  orderNumber: string;
  table: string;
  waiter: string;
  time: string;
  items: Array<{
    quantity: number;
    name: string;
    modifiers: string[];
    notes?: string;
  }>;
  notes?: string;
}

/** Printed tickets: 2 decimals with thousands separators. */
const money2 = (n: number) => formatNumber(n);

function ticketLoadErrorMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'response' in err) {
    const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
    if (typeof msg === 'string' && msg) return msg;
  }
  if (err instanceof Error) return err.message;
  return 'Error desconocido';
}

interface TicketPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: number;
  type?: 'customer' | 'kitchen';
}

const TicketPrintModal: React.FC<TicketPrintModalProps> = ({
  isOpen,
  onClose,
  orderId,
  type = 'customer'
}) => {
  const [ticketData, setTicketData] = useState<CustomerTicketData | KitchenTicketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [printerWidth, setPrinterWidth] = useState<58 | 80>(80);

  const loadTicketData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const endpoint = type === 'kitchen'
        ? `/advanced/tickets/${orderId}/kitchen`
        : `/advanced/tickets/${orderId}`;

      const response = await api.get<{ data: CustomerTicketData | KitchenTicketData }>(endpoint);
      setTicketData(response.data.data);
    } catch (error: unknown) {
      console.error('Error loading ticket:', error);
      setLoadError('Error al cargar el ticket: ' + ticketLoadErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [orderId, type]);

  useEffect(() => {
    if (isOpen) {
      loadTicketData();
    }
  }, [isOpen, loadTicketData]);

  const handlePrint = () => {
    setPrintError(null);
    if (!ticketData || loadError) {
      setPrintError('El ticket no está disponible; vuelve a cargarlo antes de imprimir');
      return;
    }
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      setPrintError('Por favor permite ventanas emergentes para imprimir');
      return;
    }

    const content = type === 'kitchen' ? renderKitchenTicket() : renderCustomerTicket();

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Ticket #${orderId}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: 'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
              font-size: 13px;
              line-height: 1.5;
              padding: 10px;
              max-width: ${printerWidth === 58 ? '58mm' : '80mm'};
              color: #333;
              background-color: #fff;
            }
            .center { text-align: center; }
            .bold { font-weight: bold; }
            .header-logo { max-width: 60%; margin: 0 auto 10px; display: block; }
            .business-name { font-size: 18px; font-weight: 800; color: #000; margin-bottom: 5px; }
            .separator { border-top: 1px dashed #ccc; margin: 10px 0; }
            .line { display: flex; justify-content: space-between; margin: 4px 0; }
            .item-line { display: flex; align-items: flex-start; margin-bottom: 6px; }
            .item-qty { font-weight: bold; width: 30px; }
            .item-desc { flex: 1; }
            .item-price { text-align: right; font-weight: bold; }
            .total { font-size: 18px; font-weight: 900; margin-top: 5px; border-top: 2px solid #000; padding-top: 10px; }
            .footer { font-size: 11px; margin-top: 15px; color: #666; font-style: italic; }
            @media print {
              body { padding: 0; }
            }
          </style>
        </head>
        <body>
          ${content}
        </body>
      </html>
    `);

    let printed = false;
    const printWhenReady = () => {
      if (printed || printWindow.closed) return;
      printed = true;
      printWindow.print();
      printWindow.close();
    };
    printWindow.addEventListener('load', printWhenReady, { once: true });
    printWindow.document.close();
    // Some popup documents do not emit load consistently. Keep a bounded
    // fallback, while the guard above prevents a duplicate print dialog.
    setTimeout(printWhenReady, 1_500);
  };

  const renderCustomerTicket = () => {
    if (!ticketData || type !== 'customer') return '';
    const ticketDataCustomer = ticketData as CustomerTicketData;

    const e = escapeHtml;
    return `
      ${ticketDataCustomer.header.logoUrl ? `<img src="${e(resolveAssetUrl(ticketDataCustomer.header.logoUrl))}" class="header-logo" />` : ''}
      <div class="center business-name">${e(ticketDataCustomer.header.businessName)}</div>
      ${ticketDataCustomer.header.ruc ? `<div class="center info-detail">RUC: ${e(ticketDataCustomer.header.ruc)}</div>` : ''}
      ${ticketDataCustomer.header.address ? `<div class="center info-detail">${e(ticketDataCustomer.header.address)}</div>` : ''}
      ${ticketDataCustomer.header.phone ? `<div class="center info-detail">Tel: ${e(ticketDataCustomer.header.phone)}</div>` : ''}
      <div class="separator"></div>

      <div style="position: relative;">
        ${ticketDataCustomer.order.financialStatus === 'PAID' ?
        `<div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-15deg); font-size: 40px; font-weight: 900; color: rgba(0,0,0,0.05); border: 4px solid rgba(0,0,0,0.05); padding: 5px 15px; border-radius: 10px; pointer-events: none; text-transform: uppercase;">PAGADA</div>`
        : ''
      }
        
        <div class="line">
          <span>TICKET #:</span>
          <span class="bold">${e(ticketDataCustomer.order.number)}</span>
        </div>
        <div class="line">
          <span>Fecha:</span>
          <span>${e(new Date(ticketDataCustomer.order.date).toLocaleString())}</span>
        </div>
        <div class="line">
          <span>Mesa / Mesero:</span>
          <span>${e(ticketDataCustomer.order.table)} / ${e(ticketDataCustomer.order.waiter)}</span>
        </div>
        ${ticketDataCustomer.order.customerName ? `<div class="line"><span>Cliente:</span><span class="bold">${e(ticketDataCustomer.order.customerName)}</span></div>` : ''}
      </div>
      <div class="separator"></div>
      
      ${ticketDataCustomer.items.map((item) => `
        <div class="item-line">
          <span class="item-qty">${e(item.quantity)}x</span>
          <div class="item-desc">
            <span class="bold">${e(item.name)}</span>
            <div style="font-size: 10px; color: #666;">Precio: ${e(ticketDataCustomer.header.currency_symbol || '$')}${money2(item.price)}</div>
            ${item.modifiers.map((mod) => `<div style="font-size: 10px; color: #666;">+ ${e(mod.name)}</div>`).join('')}
          </div>
          <span class="item-price">${e(ticketDataCustomer.header.currency_symbol || '$')}${money2(item.subtotal)}</span>
        </div>
      `).join('')}
      
      <div class="separator"></div>
      <div class="line">
        <span>Subtotal:</span>
        <span>${e(ticketDataCustomer.header.currency_symbol || '$')}${money2(ticketDataCustomer.totals.subtotal)}</span>
      </div>
      <div class="line">
        <span>IVA:</span>
        <span>${e(ticketDataCustomer.header.currency_symbol || '$')}${money2(ticketDataCustomer.totals.tax)}</span>
      </div>
      ${ticketDataCustomer.totals.discount > 0 ? `
        <div class="line" style="color: #d32f2f;">
          <span>Descuento (${e(ticketDataCustomer.totals.discountCode || '')}):</span>
          <span>-${e(ticketDataCustomer.header.currency_symbol || '$')}${money2(ticketDataCustomer.totals.discount)}</span>
        </div>
      ` : ''}
      ${ticketDataCustomer.totals.tip > 0 ? `
        <div class="line">
          <span>Propina:</span>
          <span>${e(ticketDataCustomer.header.currency_symbol || '$')}${money2(ticketDataCustomer.totals.tip)}</span>
        </div>
      ` : ''}
      <div class="line total">
        <span>TOTAL:</span>
        <span>${e(ticketDataCustomer.header.currency_symbol || '$')}${money2(ticketDataCustomer.totals.total)}</span>
      </div>
      <div class="separator"></div>
      
      ${ticketDataCustomer.payments && ticketDataCustomer.payments.length > 0 ? `
        <div class="bold" style="margin-bottom: 5px; font-size: 11px; text-transform: uppercase;">Pagado con:</div>
        ${ticketDataCustomer.payments.map((p) => `
          <div class="line">
            <span>${e(p.method)}:</span>
            <span class="bold">${e(ticketDataCustomer.header.currency_symbol || '$')}${money2(p.amount)}</span>
          </div>
        `).join('')}
        <div class="separator"></div>
      ` : ''}
      
      <div class="center" style="margin: 15px 0;">
        <div style="width: 80px; height: 80px; border: 1px solid #eee; margin: 0 auto; display: flex; align-items: center; justify-content: center; background: #fafafa;">
           <span style="font-size: 8px; color: #ccc; text-align: center;">QR VALIDACIÓN</span>
        </div>
      </div>

      <div class="footer center">
        <div class="bold" style="margin-bottom: 5px;">${e(ticketDataCustomer.footer.message)}</div>
        <div>Impreso el ${e(new Date().toLocaleString())}</div>
      </div>
    `;
  };

  const renderKitchenTicket = () => {
    if (!ticketData || type !== 'kitchen') return '';
    const td = ticketData as KitchenTicketData;

    const e = escapeHtml;
    return `
      <div class="center bold" style="font-size: 16px;">COCINA</div>
      <div class="separator"></div>
      
      <div class="line bold">
        <span>Orden #:</span>
        <span>${e(td.orderNumber)}</span>
      </div>
      <div class="line">
        <span>Mesa:</span>
        <span>${e(td.table)}</span>
      </div>
      <div class="line">
        <span>Mesero:</span>
        <span>${e(td.waiter)}</span>
      </div>
      <div class="line">
        <span>Hora:</span>
        <span>${e(new Date(td.time).toLocaleTimeString())}</span>
      </div>
      <div class="separator"></div>
      
      ${td.items.map((item) => `
        <div style="margin: 10px 0;">
          <div class="bold" style="font-size: 14px;">${e(item.quantity)}x ${e(item.name)}</div>
          ${item.modifiers.length > 0 ? `
            <div style="padding-left: 10px; margin-top: 3px;">
              ${item.modifiers.map((mod) => `<div>+ ${e(mod)}</div>`).join('')}
            </div>
          ` : ''}
          ${item.notes ? `
            <div style="padding-left: 10px; margin-top: 3px; font-style: italic;">
              Nota: ${e(item.notes)}
            </div>
          ` : ''}
        </div>
        <div class="separator"></div>
      `).join('')}
      
      ${td.notes ? `<div style="margin-top: 10px; font-style: italic;">${e(td.notes)}</div>` : ''}
    `;
  };

  if (!isOpen) return null;

  return (
    <FullScreenModal
      size="compact"
      isOpen={isOpen}
      onClose={onClose}
      title={type === 'kitchen' ? 'Ticket de Cocina' : 'Ticket de Cliente'}
      footer={({ requestClose }) => (
        <>
          <Button variant="secondary" onClick={requestClose}>Cancelar</Button>
          <Button variant="primary" icon={Printer} onClick={handlePrint} disabled={loading || !ticketData || !!loadError}>
            Imprimir
          </Button>
        </>
      )}
    >
      <div className="ticket-print-content">
        {loadError && <LoadErrorState message={loadError} onRetry={() => void loadTicketData()} />}
        {printError && <p className="ticket-print-error" role="alert">{printError}</p>}
        {loading ? (
          <div className="ticket-print-loading">
            <Spinner size={20} label="Cargando ticket" /> Cargando ticket...
          </div>
        ) : (
          <>
            <Field label="Ancho de Impresora" htmlFor="ticket-width-1">
              <AppSelect
                inputId="ticket-width-1"
                options={[
                  { value: '58', label: '58mm (Pequeña)' },
                  { value: '80', label: '80mm (Estándar)' }
                ]}
                value={String(printerWidth)}
                isClearable={false}
                onChange={(option) => setPrinterWidth(parseInt(option || '80', 10) as 58 | 80)}
              />
            </Field>

            {/* Vista previa en papel: siempre clara (colores del sistema), igual que el ticket impreso. */}
            <div
              className="ticket-print-preview"
              dangerouslySetInnerHTML={{
                __html: type === 'kitchen' ? renderKitchenTicket() : renderCustomerTicket()
              }}
            />
          </>
        )}
      </div>
    </FullScreenModal>
  );
};

export default TicketPrintModal;

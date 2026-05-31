export const ORDER_STATUS_LABELS: Record<string, string> = {
    OPEN: 'Abierta',
    PENDING: 'Pendiente',
    SENT_TO_KITCHEN: 'En cocina',
    IN_PREPARATION: 'Preparando',
    READY: 'Lista',
    DELIVERED: 'Entregada',
    PAID: 'Pagada',
    CANCELLED: 'Cancelada',
    IN_PROGRESS: 'En progreso',
    DONE: 'Completado',
};

export function getOrderStatusLabel(status: string): string {
    return ORDER_STATUS_LABELS[status] ?? status.replace(/_/g, ' ');
}

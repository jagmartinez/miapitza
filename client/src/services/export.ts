import api from './api';

/**
 * Downloads a file via authenticated API request (blob).
 * Uses the configured `api` instance so auth headers are included.
 */
async function downloadFile(url: string, defaultFilename: string) {
    const response = await api.get(url, { responseType: 'blob' });
    const blob = new Blob([response.data]);
    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);

    // Try to extract filename from Content-Disposition header
    const disposition = response.headers['content-disposition'];
    const match = disposition?.match(/filename="?(.+?)"?$/);
    link.setAttribute('download', match?.[1] || defaultFilename);

    document.body.appendChild(link);
    link.click();
    // Delay revoke to ensure browser starts download before URL is freed
    setTimeout(() => {
        link.remove();
        window.URL.revokeObjectURL(link.href);
    }, 150);
}

export const exportAPI = {
    exportSales: (params?: { startDate?: string; endDate?: string; branchId?: number }) => {
        const queryParams = new URLSearchParams();
        if (params?.startDate) queryParams.append('startDate', params.startDate);
        if (params?.endDate) queryParams.append('endDate', params.endDate);
        if (params?.branchId) queryParams.append('branchId', params.branchId.toString());

        return downloadFile(`/export/sales?${queryParams.toString()}`, 'ventas.xlsx');
    },

    exportInventory: (params?: { startDate?: string; endDate?: string; warehouseId?: number }) => {
        const queryParams = new URLSearchParams();
        if (params?.startDate) queryParams.append('startDate', params.startDate);
        if (params?.endDate) queryParams.append('endDate', params.endDate);
        if (params?.warehouseId) queryParams.append('warehouseId', params.warehouseId.toString());

        return downloadFile(`/export/inventory?${queryParams.toString()}`, 'inventario.xlsx');
    },

    exportTopProducts: (params?: { startDate?: string; endDate?: string; limit?: number }) => {
        const queryParams = new URLSearchParams();
        if (params?.startDate) queryParams.append('startDate', params.startDate);
        if (params?.endDate) queryParams.append('endDate', params.endDate);
        if (params?.limit) queryParams.append('limit', params.limit.toString());

        return downloadFile(`/export/top-products?${queryParams.toString()}`, 'top-productos.xlsx');
    },

    exportSalesByUser: (params?: { startDate?: string; endDate?: string }) => {
        const queryParams = new URLSearchParams();
        if (params?.startDate) queryParams.append('startDate', params.startDate);
        if (params?.endDate) queryParams.append('endDate', params.endDate);

        return downloadFile(`/export/sales-by-user?${queryParams.toString()}`, 'ventas-por-usuario.xlsx');
    }
};

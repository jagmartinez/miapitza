import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { productsAPI } from '../services/api';
import Card from '../components/Card';
import { AlertTriangle, Package } from 'lucide-react';
import './LowStockAlert.css';

interface LowStockRow {
    id: number;
    name: string;
    currentStock?: number;
}

export default function LowStockAlert() {
    const navigate = useNavigate();
    const [lowStockItems, setLowStockItems] = useState<LowStockRow[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadLowStock();
    }, []);

    const loadLowStock = async () => {
        try {
            const response = await productsAPI.getLowStock();
            setLowStockItems(response.data.data || []);
        } catch (error) {
            console.error('Error loading low stock items:', error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) return null;
    if (lowStockItems.length === 0) return null;

    return (
        <Card className="low-stock-alert-card">
            <div className="alert-header">
                <div className="alert-title">
                    <AlertTriangle size={20} />
                    <h3>Alertas de Inventario</h3>
                </div>
                <span className="alert-count">{lowStockItems.length} items</span>
            </div>
            <div className="alert-items">
                {lowStockItems.slice(0, 5).map((item) => (
                    <div key={item.id} className="alert-item">
                        <Package size={16} />
                        <div className="item-info">
                            <span className="item-name">{item.name}</span>
                            <span className="item-stock">Stock: {item.currentStock || 0}</span>
                        </div>
                        <span className="item-status">Bajo</span>
                    </div>
                ))}
            </div>
            {lowStockItems.length > 5 && (
                <div className="alert-footer">
                    <button onClick={() => navigate('/inventory')} className="view-all-btn">
                        Ver todos ({lowStockItems.length})
                    </button>
                </div>
            )}
        </Card>
    );
}

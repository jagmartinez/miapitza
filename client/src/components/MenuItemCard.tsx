import { useState } from 'react';
import { Edit2, Trash2, Utensils, ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import type { MenuItem } from '../types';
import { useCurrency } from '../hooks/useCurrency';

interface MenuItemCardProps {
  item: MenuItem;
  onClick: (item: MenuItem) => void;
  onEdit: (item: MenuItem) => void;
  onDelete: (item: MenuItem) => void;
  onImageClick?: (item: MenuItem, imageIndex: number) => void;
}

export default function MenuItemCard({
  item,
  onClick,
  onEdit,
  onDelete,
  onImageClick,
}: MenuItemCardProps) {
  const { formatMoney } = useCurrency();
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  const images = item.images || [];
  const hasMultipleImages = images.length > 1;

  const nextImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentImageIndex((prev) => (prev + 1) % images.length);
  };

  const prevImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length);
  };

  // Determine what to display
  const displayImage = images.length > 0 ? images[currentImageIndex].imageUrl : null;

  return (
    <div className={`menu-item-card ${item.category.name.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className="item-visual-container">
        {displayImage ? (
          <>
            <img
              src={displayImage}
              alt={item.name}
              className="item-main-image"
              onClick={(e) => {
                if (onImageClick) {
                  e.stopPropagation();
                  onImageClick(item, currentImageIndex);
                }
              }}
              style={{ cursor: onImageClick ? 'zoom-in' : 'pointer' }}
            />

            {hasMultipleImages && (
              <>
                <button className="img-nav-btn prev" onClick={prevImage}>
                  <ChevronLeft size={16} />
                </button>
                <button className="img-nav-btn next" onClick={nextImage}>
                  <ChevronRight size={16} />
                </button>
                <div className="img-dots">
                  {images.map((_, idx) => (
                    <div
                      key={idx}
                      className={`img-dot ${idx === currentImageIndex ? 'active' : ''}`}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <Utensils size={40} className="item-placeholder-icon" />
        )}
      </div>

      <div className="menu-item-content">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <h3 className="item-name">{item.name}</h3>
          <span className="item-price-tag">{formatMoney(Number(item.price))}</span>
        </div>
        <p className="item-description">{item.description || 'Sin descripción.'}</p>
      </div>

      <div className="menu-card-actions">
        <button
          type="button"
          className="menu-action-btn view"
          aria-label={`Ver detalle de ${item.name}`}
          title="Ver detalle"
          onClick={(e) => {
            e.stopPropagation();
            onClick(item);
          }}
        >
          <Eye size={20} />
          <span>Ver</span>
        </button>
        <button
          type="button"
          className="menu-action-btn edit"
          aria-label={`Editar ${item.name}`}
          title="Editar"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(item);
          }}
        >
          <Edit2 size={20} />
          <span>Editar</span>
        </button>
        <button
          type="button"
          className="menu-action-btn delete"
          aria-label={`Eliminar ${item.name}`}
          title="Eliminar"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(item);
          }}
        >
          <Trash2 size={20} />
        </button>
      </div>
    </div>
  );
}

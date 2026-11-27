import { useState } from 'react';
import { Edit2, Trash2, Utensils, ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import type { MenuItem } from '../types';
import { Button, IconButton } from '@/ui';
import { useCurrency } from '../hooks/useCurrency';
import './MenuItemCard.css';

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
              className={`item-main-image ${onImageClick ? 'is-zoomable' : ''}`.trim()}
              onClick={(e) => {
                if (onImageClick) {
                  e.stopPropagation();
                  onImageClick(item, currentImageIndex);
                }
              }}
            />

            {hasMultipleImages && (
              <>
                <IconButton size="sm" icon={ChevronLeft} className="item-image-nav item-image-nav--prev" label="Imagen anterior" onClick={prevImage} />
                <IconButton size="sm" icon={ChevronRight} className="item-image-nav item-image-nav--next" label="Imagen siguiente" onClick={nextImage} />
                <div className="img-dots">
                  {images.map((_, idx) => (
                    <div
                      key={idx}
                      aria-hidden="true"
                      className={`img-dot ${idx === currentImageIndex ? 'active' : ''}`}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <Utensils size={40} className="item-placeholder-icon" aria-hidden="true" />
        )}
      </div>

      <div className="menu-item-content">
        <div className="menu-item-card__title-row">
          <h3 className="item-name">{item.name}</h3>
          <span className="item-price-tag">{formatMoney(Number(item.price))}</span>
        </div>
        <p className="item-description">{item.description || 'Sin descripción.'}</p>
      </div>

      <div className="menu-card-actions">
        <Button
          variant="ghost"
          icon={Eye}
          className="menu-card__action"
          aria-label={`Ver detalle de ${item.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onClick(item);
          }}
        >
          Ver
        </Button>
        <Button
          variant="ghost"
          icon={Edit2}
          className="menu-card__action menu-card__action--edit"
          aria-label={`Editar ${item.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onEdit(item);
          }}
        >
          Editar
        </Button>
        <IconButton
          icon={Trash2}
          tone="danger"
          className="menu-card__action menu-card__action--delete"
          label={`Eliminar ${item.name}`}
          tooltip="Eliminar"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(item);
          }}
        />
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useDialogA11y } from '../hooks/useDialogA11y';
import './ImageViewer.css';

interface ImageViewerProps {
    images: string[];
    initialIndex?: number;
    isOpen: boolean;
    onClose: () => void;
}

export default function ImageViewer({ images, initialIndex = 0, isOpen, onClose }: ImageViewerProps) {
    const [currentIndex, setCurrentIndex] = useState(initialIndex);
    const containerRef = useRef<HTMLDivElement>(null);
    useDialogA11y(isOpen, onClose, containerRef);

    useEffect(() => {
        if (isOpen) {
            setCurrentIndex(initialIndex);
        }
    }, [isOpen, initialIndex]);

    useEffect(() => {
        if (!isOpen || images.length <= 1) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
            } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                setCurrentIndex((prev) => (prev + 1) % images.length);
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, images.length]);

    if (!isOpen) return null;

    const handleNext = (e: React.MouseEvent) => {
        e.stopPropagation();
        setCurrentIndex((prev) => (prev + 1) % images.length);
    };

    const handlePrev = (e: React.MouseEvent) => {
        e.stopPropagation();
        setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
    };

    return createPortal(
        <div className="image-viewer-overlay" onClick={onClose}>
            <button type="button" className="viewer-close-btn" onClick={onClose} aria-label="Cerrar visor de imagen">
                <X size={24} aria-hidden="true" />
            </button>

            <div
                ref={containerRef}
                className="viewer-content"
                role="dialog"
                aria-modal="true"
                aria-label={`Imagen ${currentIndex + 1} de ${images.length}`}
                tabIndex={-1}
                onClick={(e) => e.stopPropagation()}
            >
                <img
                    src={images[currentIndex]}
                    alt={`View ${currentIndex + 1}`}
                    className="viewer-image"
                />

                {images.length > 1 && (
                    <>
                        <button type="button" className="viewer-nav-btn prev" onClick={handlePrev} aria-label="Imagen anterior">
                            <ChevronLeft size={32} aria-hidden="true" />
                        </button>
                        <button type="button" className="viewer-nav-btn next" onClick={handleNext} aria-label="Imagen siguiente">
                            <ChevronRight size={32} aria-hidden="true" />
                        </button>
                        <div className="viewer-counter">
                            {currentIndex + 1} / {images.length}
                        </div>
                    </>
                )}
            </div>
        </div>,
        document.body
    );
}

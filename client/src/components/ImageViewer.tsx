import { useEffect, useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { createPortal } from 'react-dom';
import './ImageViewer.css';

interface ImageViewerProps {
    images: string[];
    initialIndex?: number;
    isOpen: boolean;
    onClose: () => void;
}

export default function ImageViewer({ images, initialIndex = 0, isOpen, onClose }: ImageViewerProps) {
    const [currentIndex, setCurrentIndex] = useState(initialIndex);

    useEffect(() => {
        if (isOpen) {
            setCurrentIndex(initialIndex);
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [isOpen, initialIndex]);

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
            <button className="viewer-close-btn" onClick={onClose}>
                <X size={24} />
            </button>

            <div className="viewer-content" onClick={(e) => e.stopPropagation()}>
                <img
                    src={images[currentIndex]}
                    alt={`View ${currentIndex + 1}`}
                    className="viewer-image"
                />

                {images.length > 1 && (
                    <>
                        <button className="viewer-nav-btn prev" onClick={handlePrev}>
                            <ChevronLeft size={32} />
                        </button>
                        <button className="viewer-nav-btn next" onClick={handleNext}>
                            <ChevronRight size={32} />
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

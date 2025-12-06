import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Star } from 'lucide-react';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useModalStore } from '../../utils/modalManager';
import { ImageComponent } from '../../hooks/useImage.jsx';
import { useTranslation } from 'react-i18next';
import { useRTL } from '../../hooks/useRTL';

/**
 * Modal for selecting which face to use as representative when an image has multiple faces from the same group
 */
export default function SelectFaceForRepModal({ isOpen, onClose, faces, urlHelpers, groupLabel, onSelect }) {
  const { t } = useTranslation();
  const { isRTL } = useRTL();
  const [selectedFaceId, setSelectedFaceId] = useState(null);
  const [modalId] = useState(() => `select-face-rep-modal-${Math.random().toString(36).slice(2)}`);

  const handleSelect = () => {
    if (selectedFaceId) {
      onSelect(selectedFaceId);
      setSelectedFaceId(null);
      onClose();
    }
  };

  const handleCancel = () => {
    setSelectedFaceId(null);
    onClose();
  };

  // Custom keyboard handler for Enter key and arrow navigation
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && selectedFaceId && faces.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      handleSelect();
      return true;
    }
    
    // Arrow key navigation
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      
      if (faces.length === 0) return true;
      
      const currentIndex = faces.findIndex(face => 
        (face.id || face.face_id) === selectedFaceId
      );
      
      let newIndex = currentIndex;
      const cols = 3; // Grid has 3 columns
      
      switch (e.key) {
        case 'ArrowLeft':
          newIndex = currentIndex > 0 ? currentIndex - 1 : faces.length - 1;
          break;
        case 'ArrowRight':
          newIndex = currentIndex < faces.length - 1 ? currentIndex + 1 : 0;
          break;
        case 'ArrowUp':
          newIndex = currentIndex >= cols ? currentIndex - cols : currentIndex;
          break;
        case 'ArrowDown':
          newIndex = currentIndex + cols < faces.length ? currentIndex + cols : currentIndex;
          break;
      }
      
      if (newIndex >= 0 && newIndex < faces.length) {
        const newFaceId = faces[newIndex]?.id || faces[newIndex]?.face_id;
        if (newFaceId) {
          setSelectedFaceId(newFaceId);
        }
      }
      
      return true;
    }
    
    return false;
  };

  // Use modal focus hook
  const { modalRef } = useModalFocus(isOpen, onClose, {
    modalId,
    modalType: 'popup',
    customKeyHandler: handleKeyDown,
    allowOutsideScroll: true
  });

  // Auto-select the first face when modal opens
  useEffect(() => {
    if (isOpen && faces && faces.length > 0) {
      const firstFaceId = faces[0]?.id || faces[0]?.face_id;
      if (firstFaceId) {
        setSelectedFaceId(firstFaceId);
      }
    }
  }, [isOpen, faces]);

  // Register modal with modal manager
  useEffect(() => {
    if (!isOpen) return;
    const { registerModal, unregisterModal } = useModalStore.getState();
    try {
      registerModal({ id: modalId, type: 'popup', allowOutsideScroll: true });
    } catch {}
    
    // Listen for logout to auto-close modal
    const handleAuthLogout = () => {
      onClose();
    };
    window.addEventListener('auth:logout', handleAuthLogout);
    
    return () => {
      try {
        unregisterModal(modalId);
      } catch {}
      window.removeEventListener('auth:logout', handleAuthLogout);
    };
  }, [isOpen, modalId]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 modal-overlay">
        <motion.div
          ref={modalRef}
          className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          tabIndex={-1}
          dir={isRTL ? 'rtl' : 'ltr'}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">
              {t('selectFaceForRep.selectFaceFor')} {groupLabel}
            </h2>
            <button
              onClick={handleCancel}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title={t('selectFaceForRep.cancel')}
              aria-label={t('selectFaceForRep.cancel')}
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6">
            <p className="text-sm text-gray-600 mb-4">
              {t('selectFaceForRep.thisImageContainsMultipleFacesFrom')} {groupLabel}. {t('selectFaceForRep.selectWhichOneToUseAsTheRepresentative')}
            </p>
            
            {faces.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>{t('selectFaceForRep.noFacesFoundInThisImage')}</p>
                <p className="text-xs mt-2">{t('selectFaceForRep.thisMayHappenWhenUsingFiltersWithOrOperator')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3 max-h-96 overflow-y-auto">
                {faces.map((face) => {
                  const faceId = face.id || face.face_id;
                  const imageSrc = faceId && urlHelpers
                    ? urlHelpers.getFaceCropUrl(faceId)
                    : null;
                  
                  return (
                    <button
                      key={faceId}
                      type="button"
                      onClick={() => setSelectedFaceId(faceId)}
                      className={`relative rounded-lg overflow-hidden border-2 transition-all ${
                        selectedFaceId === faceId
                          ? 'border-yellow-500 ring-2 ring-yellow-200'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {ImageComponent(imageSrc, {
                        width: 100,
                        height: 100,
                        className: 'w-full h-24 object-cover',
                        alt: `Face option`,
                        iconType: 'person'
                      })}
                      {selectedFaceId === faceId && (
                        <div className="absolute inset-0 bg-yellow-500 bg-opacity-20 flex items-center justify-center">
                          <div className="w-6 h-6 bg-yellow-500 rounded-full flex items-center justify-center">
                            <Star className="w-3 h-3 text-white fill-white" />
                          </div>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 px-6 pb-6">
            <button
              type="button"
              onClick={handleSelect}
              className="btn-primary flex items-center gap-2"
              disabled={!selectedFaceId || faces.length === 0}
            >
              <Star className="w-4 h-4" />
              <span>{t('selectFaceForRep.setAsRepresentative')}</span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}





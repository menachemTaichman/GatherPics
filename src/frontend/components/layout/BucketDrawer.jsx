import { useMemo, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Trash2, Check, Upload, Download, Image as ImageIcon } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useBucketStore from '../../utils/bucketStore';
import { urlHelpers, downloadAPI, imagesAPI } from '../../utils/apiService';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useModalManager } from '../../utils/modalManager';
import { RemovableThumbnail } from '../common';
import { useRTL } from '../../hooks/useRTL';
import { downloadAsZip } from '../../utils/downloadHelper';
import SimpleVirtuosoGrid from '../images/SimpleVirtuosoGrid';
import { useEventId } from '../../utils/storeUtils';
import { useImageComponent } from '../../hooks/useImage.jsx';

export default function BucketDrawer() {
  const [note, setNote] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0, filename: '' });
  const { t } = useTranslation();
  const { isRTL, startClass, endClass } = useRTL();
  
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(''), 2500);
    return () => clearTimeout(t);
  }, [note]);
  const params = useParams();
  const eventUrl = params.eventUrl;
  const {
    isOpen,
    mode,
    quality,
    excludeAlready,
    queue,
    downloaded,
    uploaded,
    close,
    setMode,
    setQuality,
    setExcludeAlready,
    clearQueue,
    clearDownloaded,
    clearUploaded,
    markDownloaded,
    markUploaded,
    removeManyFromQueue
  } = useBucketStore();

  const { registerModal, unregisterModal } = useModalManager();
  const modalId = 'bucket-drawer';

  // Register modal when opened, unregister when closed
  useEffect(() => {
    if (isOpen) {
      registerModal({ 
        id: modalId, 
        type: 'panel',
        allowOutsideScroll: true,
        scopes: []
      });
      
      // Listen for logout to auto-close modal
      const handleAuthLogout = () => {
        close();
      };
      window.addEventListener('auth:logout', handleAuthLogout);
      
      return () => {
        unregisterModal(modalId);
        window.removeEventListener('auth:logout', handleAuthLogout);
      };
    }
  }, [isOpen, registerModal, unregisterModal]);

  const { modalRef } = useModalFocus(isOpen, close, {
    modalId: modalId,
    modalType: 'panel',
    allowOutsideScroll: true,
    enableFocusTrapping: true,
    enableBackButton: true // Explicitly enable browser back button to close drawer
  });

  const alreadyList = mode === 'download' ? downloaded : uploaded;

  const compactList = useMemo(() => alreadyList.slice(0, 30), [alreadyList]);

  // Convert queue to items format for AbsoluteMasonryGrid
  const queueItems = useMemo(() => {
    return queue.map(id => ({ id, imageId: id }));
  }, [queue]);

  // Convert alreadyList to items format for AbsoluteMasonryGrid
  const alreadyListItems = useMemo(() => {
    return alreadyList.map(id => ({ id, imageId: id }));
  }, [alreadyList]);

  // Define renderItem callbacks separately to keep references stable
  const renderQueueItem = useCallback((item) => (
    <BucketThumb eventUrl={eventUrl} imageId={item.imageId} size="medium" removeFrom="queue" />
  ), [eventUrl]);

  const renderAlreadyListItem = useCallback((item) => (
    <BucketThumb eventUrl={eventUrl} imageId={item.imageId} size="small" removeFrom={mode === 'download' ? 'downloaded' : 'uploaded'} />
  ), [eventUrl, mode]);

  const handlePrimaryAction = async () => {
    if (queue.length === 0) return;
    if (mode === 'download') {
      try {
        // Exclude already-downloaded if toggle is on
        const already = new Set(downloaded);
        const toDownload = excludeAlready ? queue.filter(id => !already.has(id)) : queue.slice();
        if (toDownload.length === 0) {
          setNote(t('bucketDrawer.nothingToDownload'));
          return;
        }

        setDownloading(true);
        setDownloadProgress({ current: 0, total: toDownload.length, filename: '' });
        setNote(t('bucketDrawer.gettingDownloadUrls'));

        // 1. Create Promise for getting URLs (without await!)
        const filesPromise = downloadAPI.getDownloadUrls(toDownload, eventUrl, { quality })
          .then(response => {
            // Checks and error handling inside the Promise
            if (response.failed_images && response.failed_images.length > 0) {
              // Can show message, but don't stop the flow
              setNote(t('bucketDrawer.someImagesFailed', { count: response.failed_images.length }));
            }
            
            if (!response.files || response.files.length === 0) {
              throw new Error('No files available to download');
            }
            
            return response.files;
          });

        setNote(t('bucketDrawer.downloadingZip'));

        // 2. Call download function immediately (pass the Promise)
        await downloadAsZip(
          filesPromise, // Pass the promise, not the result
          'images.zip',
          (current, total, filename) => {
            setDownloadProgress({ current, total, filename });
            setNote(t('bucketDrawer.downloadingProgress', { current, total }));
          }
        );

        setNote(t('bucketDrawer.downloadComplete'));
        markDownloaded(toDownload);
        // Remove only the downloaded ones from queue
        removeManyFromQueue(toDownload);
        
        // Clear progress after a short delay
        setTimeout(() => {
          setDownloading(false);
          setDownloadProgress({ current: 0, total: 0, filename: '' });
        }, 2000);
      } catch (e) {
        console.error('Download failed:', e);
        setNote(t('bucketDrawer.downloadFailed', { error: e.message }));
        setDownloading(false);
      }
    } else {
      // Upload to Google Photos: to be implemented later
      // For now, respect excludeAlready for uploaded too
      const alreadyUp = new Set(uploaded);
      const toUpload = excludeAlready ? queue.filter(id => !alreadyUp.has(id)) : queue.slice();
      if (toUpload.length === 0) {
        setNote(t('bucketDrawer.nothingToUpload'));
        return;
      }
      markUploaded(toUpload);
      removeManyFromQueue(toUpload);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.aside
          ref={modalRef}
          key="bucket-drawer"
          initial={{ x: isRTL ? '100%' : '-100%' }}
          animate={{ x: 0 }}
          exit={{ x: isRTL ? '100%' : '-100%' }}
          transition={{ type: 'spring', stiffness: 260, damping: 30 }}
          dir={isRTL ? 'rtl' : 'ltr'}
          className={`fixed top-16 h-[calc(100vh-4rem)] w-[360px] bg-white shadow-xl z-[100] flex flex-col ${startClass('0')} ${isRTL ? 'border-l border-gray-200' : 'border-r border-gray-200'}`}
        >
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              {mode === 'download' ? <Download className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
              <span>{t('bucketDrawer.bucket')}</span>
            </h3>
            <button 
              onClick={close} 
              className="p-2 hover:bg-gray-100 rounded-lg"
              title={t('account.close')}
              aria-label={t('account.close')}
            >
              <X className="w-5 h-5 text-gray-600" />
            </button>
          </div>

          {/* Preferences */}
          <div className="p-4 space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700">{t('bucketDrawer.mode')}</label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  onClick={() => setMode('download')}
                  className={`px-3 py-2 rounded-md border text-sm flex items-center justify-center gap-2 ${mode === 'download' ? 'bg-primary-100 text-primary-700 border-primary-200' : 'hover:bg-gray-50 border-gray-300'}`}
                >
                  <Download className="w-4 h-4" />
                  <span>{t('bucketDrawer.download')}</span>
                </button>
                <button
                  onClick={() => setMode('upload')}
                  className={`px-3 py-2 rounded-md border text-sm flex items-center justify-center gap-2 ${mode === 'upload' ? 'bg-primary-100 text-primary-700 border-primary-200' : 'hover:bg-gray-50 border-gray-300'}`}
                >
                  <Upload className="w-4 h-4" />
                  <span>{t('bucketDrawer.upload')}</span>
                </button>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700">{t('bucketDrawer.quality')}</label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  onClick={() => setQuality('high')}
                  className={`px-3 py-2 rounded-md border text-sm ${quality === 'high' ? 'bg-primary-100 text-primary-700 border-primary-200' : 'hover:bg-gray-50 border-gray-300'}`}
                >
                  {t('bucketDrawer.highQuality')}
                </button>
                <button
                  onClick={() => setQuality('original')}
                  className={`px-3 py-2 rounded-md border text-sm ${quality === 'original' ? 'bg-primary-100 text-primary-700 border-primary-200' : 'hover:bg-gray-50 border-gray-300'}`}
                >
                  {t('bucketDrawer.original')}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">
                {mode === 'download' ? t('bucketDrawer.excludeAlreadyDownloaded') : t('bucketDrawer.excludeAlreadyUploaded')}
              </span>
              <button
                onClick={() => setExcludeAlready(!excludeAlready)}
                className={`w-10 h-6 rounded-full relative transition-colors ${excludeAlready ? 'bg-primary-600' : 'bg-gray-300'}`}
                aria-pressed={excludeAlready}
                title={mode === 'download' ? t('bucketDrawer.excludeAlreadyDownloaded') : t('bucketDrawer.excludeAlreadyUploaded')}
                aria-label={mode === 'download' ? t('bucketDrawer.excludeAlreadyDownloaded') : t('bucketDrawer.excludeAlreadyUploaded')}
              >
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${isRTL ? 'right-0.5' : 'left-0.5'} ${excludeAlready ? (isRTL ? '-translate-x-4' : 'translate-x-4') : ''}`} />
              </button>
            </div>
          </div>

          {/* Queue */}
          <div className="px-4 pb-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-gray-700">{t('bucketDrawer.queue')} ({queue.length})</h4>
              <button 
                onClick={clearQueue} 
                className="text-xs text-red-600 hover:underline flex items-center gap-1"
                title={t('bucketDrawer.clear')}
                aria-label={t('bucketDrawer.clear')}
              >
                <Trash2 className="w-3 h-3" />
                <span>{t('bucketDrawer.clear')}</span>
              </button>
            </div>
          </div>
          <div className="px-4 flex-1 overflow-y-auto">
            {queue.length === 0 ? (
              <p className="text-sm text-gray-500">{t('bucketDrawer.noItemsInQueue')}</p>
            ) : (
              <SimpleVirtuosoGrid
                items={queueItems}
                baseSize={48}
                gap={8}
                containerHeight="100%"
                className="w-full"
                overscan={1500}
                disableMinHeight={true}
                renderItem={renderQueueItem}
              />
            )}
          </div>

          {/* Already list */}
          <div className="p-4 border-t border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-gray-700">
                {mode === 'download' ? t('bucketDrawer.alreadyDownloaded') : t('bucketDrawer.alreadyUploaded')} ({alreadyList.length})
              </h4>
              <button
                onClick={mode === 'download' ? clearDownloaded : clearUploaded}
                className="text-xs text-gray-600 hover:underline"
                title={t('bucketDrawer.clearList')}
                aria-label={t('bucketDrawer.clearList')}
              >
                {t('bucketDrawer.clearList')}
              </button>
            </div>
            {alreadyList.length === 0 ? (
              <p className="text-xs text-gray-400">{t('bucketDrawer.nothingYet')}</p>
            ) : (
              <div className="h-48 overflow-y-auto">
                <SimpleVirtuosoGrid
                  items={alreadyListItems}
                  baseSize={48}
                  gap={8}
                  containerHeight="auto"
                  className="w-full"
                  overscan={1500}
                  renderItem={renderAlreadyListItem}
                />
              </div>
            )}
          </div>

          {/* Footer actions */}
          <div className="p-4 border-t border-gray-200">
            {note && (
              <div className="text-xs text-gray-500 mb-2" title={note}>
                {note}
                {downloading && downloadProgress.total > 0 && (
                  <div className="mt-1">
                    <div className="w-full bg-gray-200 rounded-full h-1.5">
                      <div 
                        className="bg-primary-600 h-1.5 rounded-full transition-all duration-300"
                        style={{ width: `${(downloadProgress.current / downloadProgress.total) * 100}%` }}
                      />
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {downloadProgress.current} / {downloadProgress.total}
                      {downloadProgress.filename && ` - ${downloadProgress.filename}`}
                    </div>
                  </div>
                )}
              </div>
            )}
            <button
              disabled={queue.length === 0 || downloading}
              onClick={handlePrimaryAction}
              className={`w-full inline-flex items-center justify-center px-4 py-2 rounded-md text-white font-medium gap-2 ${queue.length === 0 || downloading ? 'bg-gray-300 cursor-not-allowed' : 'bg-primary-600 hover:bg-primary-700'}`}
            >
              {mode === 'download' ? <Download className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
              <span>
                {downloading 
                  ? t('bucketDrawer.downloading') 
                  : (mode === 'download' ? t('bucketDrawer.downloadAsZip') : t('bucketDrawer.uploadToGooglePhotos'))
                }
              </span>
            </button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function BucketThumb({ eventUrl, imageId, size = 'medium', removeFrom = 'queue' }) {
  const { t } = useTranslation();
  const { isRTL } = useRTL();
  const eventId = useEventId(eventUrl);
  
  // Construct thumbnail URL synchronously if we have eventId, otherwise use a lazy function
  // This avoids eager API calls - useImageComponent will handle lazy loading with Intersection Observer
  const getThumbnailUrl = useMemo(() => {
    if (eventId) {
      // Use sync version if we have eventId
      return `/api/events/${eventId}/thumb/${imageId}.webp`;
    }
    // Return null if eventId not available yet - useImageComponent will handle it
    return null;
  }, [eventId, imageId]);

  const { removeFromQueue, removeDownloaded, removeUploaded, addToQueue } = useBucketStore.getState();
  
  const handleRemove = () => {
    if (removeFrom === 'queue') {
      removeFromQueue(imageId);
    } else if (removeFrom === 'downloaded') {
      removeDownloaded(imageId);
    } else if (removeFrom === 'uploaded') {
      removeUploaded(imageId);
    }
  };

  const handleAddBack = (e) => {
    e.stopPropagation();
    addToQueue([imageId]);
  };

  // For queue items, use the RemovableThumbnail component
  if (removeFrom === 'queue') {
    return (
      <RemovableThumbnail
        imageUrl={getThumbnailUrl}
        alt={imageId}
        onRemove={handleRemove}
        size={size}
        title={t('bucketDrawer.clickToRemoveFromQueue')}
      />
    );
  }

  // For already downloaded/uploaded items, show special dual-button layout
  // Use useImageComponent for lazy loading with Intersection Observer
  return (
    <div className="group relative w-12 h-12 rounded-lg overflow-hidden bg-gray-100 border border-gray-200 hover:border-blue-300 transition-all">
      {useImageComponent(getThumbnailUrl, {
        width: 48,
        height: 48,
        className: 'w-full h-full object-cover',
        alt: imageId
      })}
      {/* Add back to queue button (top-end in LTR, top-start in RTL) */}
      <button
        onClick={handleAddBack}
        className={`absolute -top-1 ${isRTL ? '-left-1' : '-right-1'} w-4 h-4 rounded-full bg-green-500 text-white text-[10px] leading-[14px] hover:bg-green-600 flex items-center justify-center shadow-sm opacity-0 group-hover:opacity-100 transition-opacity z-10`}
        title={t('bucketDrawer.addBackToQueue')}
        aria-label={t('bucketDrawer.addBackToQueue')}
      >
        +
      </button>
      {/* Remove from list button (top-start in LTR, top-end in RTL) */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleRemove();
        }}
        className={`absolute -top-1 ${isRTL ? '-right-1' : '-left-1'} w-4 h-4 rounded-full bg-red-500 text-white text-[10px] leading-[14px] hover:bg-red-600 flex items-center justify-center shadow-sm opacity-0 group-hover:opacity-100 transition-opacity z-10`}
        title={removeFrom === 'downloaded' ? t('bucketDrawer.removeFromDownloadedList') : t('bucketDrawer.removeFromUploadedList')}
        aria-label={removeFrom === 'downloaded' ? t('bucketDrawer.removeFromDownloadedList') : t('bucketDrawer.removeFromUploadedList')}
      >
        ×
      </button>
    </div>
  );
}

function placeholder() {
  const span = document.createElement('span');
  span.className = 'w-full h-full grid place-items-center text-gray-400';
  span.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-image"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-5-5L5 21"></path></svg>';
  return span;
}






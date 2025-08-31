import { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Trash2, Check, Upload, Download, Image as ImageIcon } from 'lucide-react';
import { useParams } from 'react-router-dom';
import useBucketStore from '../utils/bucketStore';
import { urlHelpers, downloadAPI, imagesAPI } from '../utils/apiService';

export default function BucketDrawer() {
  const [note, setNote] = useState('');
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

  const alreadyList = mode === 'download' ? downloaded : uploaded;

  const compactList = useMemo(() => alreadyList.slice(0, 30), [alreadyList]);

  const handlePrimaryAction = async () => {
    if (queue.length === 0) return;
    if (mode === 'download') {
      try {
        // Exclude already-downloaded if toggle is on
        const already = new Set(downloaded);
        const toDownload = excludeAlready ? queue.filter(id => !already.has(id)) : queue.slice();
        if (toDownload.length === 0) {
          setNote('Nothing to download: all in list and excluded');
          return;
        }
        const blob = await downloadAPI.download(toDownload, 'zip', eventUrl, { quality });
        const url = window.URL.createObjectURL(new Blob([blob]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', 'images.zip');
        document.body.appendChild(link);
        link.click();
        link.parentNode && link.parentNode.removeChild(link);
        window.URL.revokeObjectURL(url);
        markDownloaded(toDownload);
        // Remove only the downloaded ones from queue
        removeManyFromQueue(toDownload);
      } catch (e) {
        console.error('Download failed', e);
      }
    } else {
      // Upload to Google Photos: to be implemented later
      // For now, respect excludeAlready for uploaded too
      const alreadyUp = new Set(uploaded);
      const toUpload = excludeAlready ? queue.filter(id => !alreadyUp.has(id)) : queue.slice();
      if (toUpload.length === 0) {
        setNote('Nothing to upload: all in list and excluded');
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
          key="bucket-drawer"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', stiffness: 260, damping: 30 }}
          className="fixed top-16 right-0 h-[calc(100vh-4rem)] w-[360px] bg-white border-l border-gray-200 shadow-xl z-40 flex flex-col"
        >
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
              {mode === 'download' ? <Download className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
              <span>Bucket</span>
            </h3>
            <button onClick={close} className="p-2 hover:bg-gray-100 rounded-lg">
              <X className="w-5 h-5 text-gray-600" />
            </button>
          </div>

          {/* Preferences */}
          <div className="p-4 space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Mode</label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  onClick={() => setMode('download')}
                  className={`px-3 py-2 rounded-md border text-sm flex items-center justify-center space-x-2 ${mode === 'download' ? 'bg-primary-100 text-primary-700 border-primary-200' : 'hover:bg-gray-50 border-gray-300'}`}
                >
                  <Download className="w-4 h-4" />
                  <span>Download</span>
                </button>
                <button
                  onClick={() => setMode('upload')}
                  className={`px-3 py-2 rounded-md border text-sm flex items-center justify-center space-x-2 ${mode === 'upload' ? 'bg-primary-100 text-primary-700 border-primary-200' : 'hover:bg-gray-50 border-gray-300'}`}
                >
                  <Upload className="w-4 h-4" />
                  <span>Upload</span>
                </button>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700">Quality</label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  onClick={() => setQuality('high')}
                  className={`px-3 py-2 rounded-md border text-sm ${quality === 'high' ? 'bg-primary-100 text-primary-700 border-primary-200' : 'hover:bg-gray-50 border-gray-300'}`}
                >
                  High quality
                </button>
                <button
                  onClick={() => setQuality('original')}
                  className={`px-3 py-2 rounded-md border text-sm ${quality === 'original' ? 'bg-primary-100 text-primary-700 border-primary-200' : 'hover:bg-gray-50 border-gray-300'}`}
                >
                  Original
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">
                {mode === 'download' ? 'Exclude already downloaded' : 'Exclude already uploaded'}
              </span>
              <button
                onClick={() => setExcludeAlready(!excludeAlready)}
                className={`w-10 h-6 rounded-full relative transition-colors ${excludeAlready ? 'bg-primary-600' : 'bg-gray-300'}`}
                aria-pressed={excludeAlready}
              >
                <span className={`absolute top-0.5 ${excludeAlready ? 'left-5' : 'left-0.5'} w-5 h-5 bg-white rounded-full shadow transition-all`} />
              </button>
            </div>
          </div>

          {/* Queue */}
          <div className="px-4 pb-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-gray-700">Queue ({queue.length})</h4>
              <button onClick={clearQueue} className="text-xs text-red-600 hover:underline flex items-center space-x-1">
                <Trash2 className="w-3 h-3" />
                <span>Clear</span>
              </button>
            </div>
          </div>
          <div className="px-4 flex-1 overflow-y-auto">
            {queue.length === 0 ? (
              <p className="text-sm text-gray-500">No items in queue.</p>
            ) : (
              <div className="grid grid-cols-6 gap-2">
                {queue.map((id) => (
                  <BucketThumb key={id} eventUrl={eventUrl} imageId={id} withRemove removeFrom="queue" />
                ))}
              </div>
            )}
          </div>

          {/* Already list */}
          <div className="p-4 border-t border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-gray-700">
                {mode === 'download' ? 'Already downloaded' : 'Already uploaded'} ({alreadyList.length})
              </h4>
              <button
                onClick={mode === 'download' ? clearDownloaded : clearUploaded}
                className="text-xs text-gray-600 hover:underline"
              >
                Clear list
              </button>
            </div>
            {alreadyList.length === 0 ? (
              <p className="text-xs text-gray-400">Nothing yet.</p>
            ) : (
              <div className="grid grid-cols-8 gap-1">
                {compactList.map((id) => (
                  <BucketThumb key={`done-${id}`} eventUrl={eventUrl} imageId={id} tiny withRemove removeFrom={mode === 'download' ? 'downloaded' : 'uploaded'} />
                ))}
              </div>
            )}
          </div>

          {/* Footer actions */}
          <div className="p-4 border-t border-gray-200">
            {note && (
              <div className="text-xs text-gray-500 mb-2" title={note}>{note}</div>
            )}
            <button
              disabled={queue.length === 0}
              onClick={handlePrimaryAction}
              className={`w-full inline-flex items-center justify-center px-4 py-2 rounded-md text-white font-medium ${queue.length === 0 ? 'bg-gray-300 cursor-not-allowed' : 'bg-primary-600 hover:bg-primary-700'}`}
            >
              {mode === 'download' ? <Download className="w-4 h-4 mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
              {mode === 'download' ? 'Download as ZIP' : 'Upload to Google Photos'}
            </button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function BucketThumb({ eventUrl, imageId, tiny = false, withRemove = false, removeFrom = 'queue' }) {
  const sizeClass = tiny ? 'w-7 h-7' : 'w-12 h-12';
  const getUrl = async () => {
    try {
      return await urlHelpers.getRelativeThumbnailUrl(eventUrl, imageId);
    } catch {
      return '';
    }
  };
  // Resolve a human-readable label for hover title
  const getLabel = async () => {
    try {
      const info = await imagesAPI.getInfo(imageId, eventUrl);
      return info?.label || imageId;
    } catch {
      return imageId;
    }
  };

  const { removeFromQueue, removeDownloaded, removeUploaded, addToQueue } = useBucketStore.getState();
  const handleQueueRemove = (e) => {
    e.stopPropagation();
    removeFromQueue(imageId);
  };
  const handleAddBack = (e) => {
    e.stopPropagation();
    addToQueue([imageId]);
  };
  const handleRemoveFromAlready = (e) => {
    e.stopPropagation();
    if (removeFrom === 'downloaded') removeDownloaded(imageId);
    if (removeFrom === 'uploaded') removeUploaded(imageId);
  };
  // Using a simple <img> with async src resolution via attribute
  return (
    <div className={`relative rounded overflow-hidden bg-gray-100 border border-gray-200 ${sizeClass}`}
      ref={async (el) => {
        if (!el) return;
        const label = await getLabel();
        el.setAttribute('title', label);
      }}
    >
      <img
        src={''}
        data-image-id={imageId}
        className="w-full h-full object-cover"
        onLoad={(e) => {
          // nothing
        }}
        onError={(e) => {
          e.currentTarget.replaceWith(placeholder());
        }}
        ref={async (el) => {
          if (!el) return;
          const url = await getUrl();
          if (url) el.src = url;
        }}
        alt="thumb"
      />
      {withRemove && (
        removeFrom === 'queue' ? (
          <button
            onClick={handleQueueRemove}
            className={`absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] leading-[14px] hover:bg-red-600 flex items-center justify-center`}
            title="Remove from queue"
          >
            ×
          </button>
        ) : (
          <>
            <button
              onClick={handleAddBack}
              className={`absolute -top-1 -right-1 w-4 h-4 rounded-full bg-green-500 text-white text-[10px] leading-[14px] hover:bg-green-600 flex items-center justify-center`}
              title="Add back to queue"
            >
              +
            </button>
            <button
              onClick={handleRemoveFromAlready}
              className={`absolute -top-1 -left-1 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] leading-[14px] hover:bg-red-600 flex items-center justify-center`}
              title={removeFrom === 'downloaded' ? 'Remove from downloaded list' : 'Remove from uploaded list'}
            >
              ×
            </button>
          </>
        )
      )}
    </div>
  );
}

function placeholder() {
  const span = document.createElement('span');
  span.className = 'w-full h-full grid place-items-center text-gray-400';
  span.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-image"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-5-5L5 21"></path></svg>';
  return span;
}



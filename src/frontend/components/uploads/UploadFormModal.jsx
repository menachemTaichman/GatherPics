import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Upload, Loader2, Check, AlertCircle, Trash2, Image as ImageIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useRTL } from '../../hooks/useRTL';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useModalManager } from '../../utils/modalManager';
import { imagesAPI, eventsAPI } from '../../utils/apiService';
import { useToast } from '../../contexts/ToastContext';
import { useApplyScopes, useEventId } from '../../utils/storeUtils';
import { useEventGeneralById } from '../../utils/dataManager';
import { formatDuration } from '../../utils/dateUtils';

export default function UploadFormModal({ 
  isOpen, 
  onClose, 
  eventUrl, 
  onUploadComplete,
  onUploadSuccess 
}) {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [assignMoments, setAssignMoments] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadStartTime, setUploadStartTime] = useState(null);
  const fileInputRef = useRef(null);
  const dragCounter = useRef(0);
  const timeUpdateIntervalRef = useRef(null);
  const { showToast } = useToast();
  const { t } = useTranslation();
  const { isRTL } = useRTL();
  const eventId = useEventId(eventUrl);
  useApplyScopes(isOpen && eventId ? [{ entity: 'event', id: String(eventId), eventId: 'general' }] : []);
  const eventData = useEventGeneralById(eventId);
  const eventLimits = useMemo(() => {
    if (!eventData) {
      return null;
    }
    const currentImagesCount = Number(eventData.images_count ?? eventData.current_images_count ?? 0);
    const imagesCountLimit = Number(eventData.images_count_limit ?? eventData.images_limit ?? 0);
    const imageSizeLimitBytes = Number(eventData.image_size_limit_bytes ?? eventData.max_image_size_bytes ?? 0);
    const availableImagesCount = imagesCountLimit > 0
      ? Math.max(0, imagesCountLimit - currentImagesCount)
      : -1;
    return {
      current_images_count: currentImagesCount,
      images_count_limit: imagesCountLimit,
      available_images_count: availableImagesCount,
      image_size_limit_bytes: imageSizeLimitBytes
    };
  }, [eventData]);
  
  const { registerModal, unregisterModal } = useModalManager();
  const modalId = 'upload-form-modal';

  // Custom keyboard handler for Enter key
  const handleUploadFormKeys = (e) => {
    if (e.key === 'Enter' && !uploading && selectedFiles.length > 0) {
      e.preventDefault();
      handleStartUpload();
      return true; // Mark as handled
    }
    return false; // Not handled
  };

  // Register modal when opened
  useEffect(() => {
    if (isOpen) {
      registerModal({ 
        id: modalId, 
        type: 'popup',
        allowOutsideScroll: true
      });
      
      // Listen for logout to auto-close modal
      const handleAuthLogout = () => {
        onClose();
      };
      window.addEventListener('auth:logout', handleAuthLogout);
      
      return () => {
        unregisterModal(modalId);
        window.removeEventListener('auth:logout', handleAuthLogout);
      };
    }
  }, [isOpen, registerModal, unregisterModal]);

  useEffect(() => {
    if (!isOpen || !eventUrl) {
      return;
    }
    const fetchEvent = async () => {
      try {
        await eventsAPI.getById(eventUrl);
      } catch (error) {
        console.error('Failed to fetch event data:', error);
      }
    };
    fetchEvent();
  }, [isOpen, eventUrl]);

  const { modalRef } = useModalFocus(isOpen, onClose, {
    customKeyHandler: handleUploadFormKeys,
    modalId: modalId,
    modalType: 'popup',
    allowOutsideScroll: true
  });

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedFiles([]);
      setUploadProgress(null);
      setUploading(false);
      setIsDragging(false);
      setUploadStartTime(null);
      if (timeUpdateIntervalRef.current) {
        clearInterval(timeUpdateIntervalRef.current);
        timeUpdateIntervalRef.current = null;
      }
    }
  }, [isOpen]);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (timeUpdateIntervalRef.current) {
        clearInterval(timeUpdateIntervalRef.current);
        timeUpdateIntervalRef.current = null;
      }
    };
  }, []);

  const validateAndAddFiles = useCallback((files) => {
    const fileArray = Array.from(files);
    
    // Filter for JPG files only
    const jpgFiles = fileArray.filter(file => 
      file.type === 'image/jpeg' || 
      file.name.toLowerCase().endsWith('.jpg') || 
      file.name.toLowerCase().endsWith('.jpeg')
    );

    if (jpgFiles.length === 0) {
      showToast(t('upload.pleaseSelectJpgFilesOnly'), 'error');
      return;
    }

    if (jpgFiles.length !== fileArray.length) {
      showToast(`${fileArray.length - jpgFiles.length} ${t('upload.nonJpgFilesWereSkipped')}`, 'warning');
    }

    // Check count limit
    if (eventLimits && eventLimits.available_images_count !== -1) {
      const totalFiles = selectedFiles.length + jpgFiles.length;
      if (totalFiles > eventLimits.available_images_count) {
        showToast(
          `${t('upload.cannotAddFiles')} ${jpgFiles.length} ${t('upload.filesYouCanOnlyUpload')} ${eventLimits.available_images_count} ${t('upload.moreImage')} ${eventLimits.images_count_limit || '∞'}`, 
          'error'
        );
        return;
      }
    }

    // Check size limit
    if (eventLimits && eventLimits.image_size_limit_bytes > 0) {
      const oversizedFiles = jpgFiles.filter(file => file.size > eventLimits.image_size_limit_bytes);
      if (oversizedFiles.length > 0) {
        const maxSizeMB = (eventLimits.image_size_limit_bytes / (1024 * 1024)).toFixed(1);
        showToast(`${oversizedFiles.length} ${t('upload.filesExceedTheSizeLimit')} ${maxSizeMB}${t('upload.mbSizeLimit')}`, 'error');
        return;
      }
    }

    // Add files WITHOUT preview URLs (created lazily when needed)
    const newFiles = jpgFiles.map(file => ({
      file,
      id: Math.random().toString(36).substr(2, 9),
      name: file.name,
      size: file.size
    }));

    setSelectedFiles(prev => [...prev, ...newFiles]);
  }, [selectedFiles, eventLimits, showToast]);

  const handleFileSelect = (event) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      validateAndAddFiles(files);
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveFile = (fileId) => {
    setSelectedFiles(prev => prev.filter(f => f.id !== fileId));
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      validateAndAddFiles(files);
    }
  };

  // Calculate overall progress percentage based on step and current/total
  const calculateOverallProgress = (progress) => {
    // Define weight for each step (total = 100%)
    const stepWeights = {
      'uploading': 1,       // 0-1% (variable, will be tested in staging)
      'validation': 1,      // 1-2%
      'processing': 87,     // 2-89% (face detection takes most time)
      'faces': 0.5,         // 89-89.5% (adding faces to DB)
      'clustering': 9,      // 89.5-98.5%
      'moments': 0.5,       // 98.5-99%
      'finalizing': 1,      // 99-100%
      'complete': 0         // 100%
    };
    
    const stepOrder = ['uploading', 'validation', 'processing', 'faces', 'clustering', 'moments', 'finalizing', 'complete'];
    const currentStepIndex = stepOrder.indexOf(progress.step);
    
    if (currentStepIndex === -1) return 0;
    
    // Calculate base progress (completed steps)
    let baseProgress = 0;
    for (let i = 0; i < currentStepIndex; i++) {
      baseProgress += stepWeights[stepOrder[i]];
    }
    
    // Calculate progress within current step
    let stepProgress = 0;
    if (progress.total > 0 && progress.current > 0) {
      stepProgress = (progress.current / progress.total) * stepWeights[progress.step];
    }
    
    return Math.min(100, baseProgress + stepProgress);
  };

  const handleStartUpload = async () => {
    if (selectedFiles.length === 0) {
      showToast(t('upload.pleaseSelectFilesToUpload'), 'error');
      return;
    }

    const startTime = Date.now();
    setUploadStartTime(startTime);
    setUploading(true);
    setUploadProgress({ 
      step: 'uploading', 
      current: selectedFiles.length, 
      total: selectedFiles.length, 
      message: `Uploading ${selectedFiles.length} image(s)...`,
      percentage: 10,
      elapsedTime: 0,
      estimatedTimeRemaining: null
    });

    // Start interval to update time display every second
    if (timeUpdateIntervalRef.current) {
      clearInterval(timeUpdateIntervalRef.current);
    }
    timeUpdateIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      setUploadProgress(prev => {
        if (!prev) return prev;
        let estimatedTimeRemaining = null;
        if (prev.percentage > 0 && prev.percentage < 100) {
          const totalEstimated = (elapsed / prev.percentage) * 100;
          estimatedTimeRemaining = Math.max(0, totalEstimated - elapsed);
        }
        return { ...prev, elapsedTime: elapsed, estimatedTimeRemaining };
      });
    }, 1000);

    try {
      const files = selectedFiles.map(f => f.file);
      
      // Use SSE-based upload with real-time progress
      const result = await imagesAPI.uploadWithProgress(
        files, 
        assignMoments, 
        eventUrl,
        (progress) => {
          // Real-time progress updates from server with calculated percentage
          const percentage = calculateOverallProgress(progress);
          const elapsed = Date.now() - startTime;
          let estimatedTimeRemaining = null;
          if (percentage > 0 && percentage < 100) {
            const totalEstimated = (elapsed / percentage) * 100;
            estimatedTimeRemaining = Math.max(0, totalEstimated - elapsed);
          }
          setUploadProgress({
            step: progress.step,
            current: progress.current,
            total: progress.total,
            message: progress.message,
            percentage: percentage,
            elapsedTime: elapsed,
            estimatedTimeRemaining: estimatedTimeRemaining
          });
        }
      );
      
      const successMsg = `${t('upload.successfullyProcessed')} ${result.images_processed} ${result.images_processed === 1 ? t('upload.image') : t('upload.imagesPlural')}, ${t('upload.detected')} ${result.faces_detected} ${result.faces_detected === 1 ? t('upload.face') : t('upload.facesPlural')}, ${t('upload.created')} ${result.groups_created} ${result.groups_created === 1 ? t('upload.group') : t('upload.groupsPlural')}`;
      
      const finalElapsed = Date.now() - startTime;
      setUploadProgress({ 
        step: 'complete', 
        current: 1, 
        total: 1, 
        message: successMsg,
        percentage: 100,
        elapsedTime: finalElapsed,
        estimatedTimeRemaining: null
      });
      
      // Clear time update interval
      if (timeUpdateIntervalRef.current) {
        clearInterval(timeUpdateIntervalRef.current);
        timeUpdateIntervalRef.current = null;
      }

      showToast(successMsg, 'success');

      if (result.errors && result.errors.length > 0) {
        console.warn('Upload errors:', result.errors);
        showToast(`${result.errors.length} ${t('upload.imageFailedToProcess')}`, 'warning');
      }

      try {
        await eventsAPI.getById(eventUrl);
      } catch (refreshError) {
        console.error('Failed to refresh event data:', refreshError);
      }

      // Notify parent to refresh limits
      if (onUploadComplete) {
        onUploadComplete(result);
      }

      // Open upload detail modal after a delay
      setTimeout(() => {
        if (onUploadSuccess && result.upload_id) {
          onUploadSuccess(result.upload_id);
        }
        onClose();
      }, 2000);

    } catch (error) {
      console.error('Upload failed:', error);
      const errorMsg = error.response?.data?.error || error.message || 'Upload failed';
      const finalElapsed = uploadStartTime ? Date.now() - uploadStartTime : 0;
      showToast(errorMsg, 'error');
      setUploadProgress({ 
        step: 'error', 
        current: 0, 
        total: 0, 
        message: errorMsg, 
        percentage: 0,
        elapsedTime: finalElapsed,
        estimatedTimeRemaining: null
      });
      setUploading(false);
      
      // Clear time update interval
      if (timeUpdateIntervalRef.current) {
        clearInterval(timeUpdateIntervalRef.current);
        timeUpdateIntervalRef.current = null;
      }
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            ref={modalRef}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            dir={isRTL ? 'rtl' : 'ltr'}
            className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
                  <Upload className="w-5 h-5 text-primary-600" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">{t('upload.uploadPhotos')}</h2>
                  <p className="text-sm text-gray-500">{t('upload.selectOrDragJpgFiles')}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                disabled={uploading}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50"
                title={t('account.cancelEsc')}
                aria-label={t('account.cancelEsc')}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Upload progress - moved to top */}
            <AnimatePresence>
              {uploadProgress && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3 }}
                  className="border-b border-gray-200"
                >
                  <div className={`px-6 py-4 ${
                    uploadProgress.step === 'complete' 
                      ? 'bg-green-50 border-green-200' 
                      : uploadProgress.step === 'error'
                      ? 'bg-red-50 border-red-200'
                      : 'bg-blue-50 border-blue-200'
                  }`}>
                    <div className="flex items-start gap-3">
                      {uploadProgress.step === 'complete' ? (
                        <Check className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                      ) : uploadProgress.step === 'error' ? (
                        <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                      ) : (
                        <Loader2 className="w-5 h-5 animate-spin text-blue-600 flex-shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1 gap-2">
                          <p className={`text-sm font-medium flex-1 min-w-0 ${
                            uploadProgress.step === 'complete' 
                              ? 'text-green-700' 
                              : uploadProgress.step === 'error'
                              ? 'text-red-700'
                              : 'text-blue-700'
                          }`}>
                            {uploadProgress.message}
                          </p>
                          {uploadProgress.percentage !== undefined && uploadProgress.step !== 'complete' && uploadProgress.step !== 'error' && (
                            <span className="text-xs font-semibold text-blue-600 flex-shrink-0">
                              {Math.round(uploadProgress.percentage)}%
                            </span>
                          )}
                        </div>
                        {uploadProgress.step !== 'complete' && uploadProgress.step !== 'error' && uploadProgress.percentage !== undefined && (
                          <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                            <div
                              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${uploadProgress.percentage || 0}%` }}
                            />
                          </div>
                        )}
                        {/* Time information */}
                        {(uploadProgress.elapsedTime !== undefined || uploadProgress.estimatedTimeRemaining !== undefined) && (
                          <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 mt-2">
                            {uploadProgress.elapsedTime !== undefined && uploadProgress.elapsedTime > 0 && (
                              <span className="whitespace-nowrap">{t('upload.timeElapsed')}: {formatDuration(uploadProgress.elapsedTime)}</span>
                            )}
                            {uploadProgress.estimatedTimeRemaining !== undefined && uploadProgress.estimatedTimeRemaining > 0 && uploadProgress.step !== 'complete' && uploadProgress.step !== 'error' && (
                              <span className="whitespace-nowrap">{t('upload.estTimeLeft')}: {formatDuration(uploadProgress.estimatedTimeRemaining)}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {/* Upload limits info */}
              {eventLimits && (
                <div className="mb-4 text-sm text-gray-600 bg-gray-50 px-4 py-3 rounded-lg">
                  <div className="flex justify-between mb-1">
                    <span>{t('upload.images')}:</span>
                    <span className="font-medium">
                      {eventLimits.current_images_count} / {eventLimits.images_count_limit > 0 ? eventLimits.images_count_limit : '∞'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('upload.maxSizePerImage')}:</span>
                    <span className="font-medium">
                      {eventLimits.image_size_limit_bytes > 0 
                        ? `${(eventLimits.image_size_limit_bytes / (1024 * 1024)).toFixed(1)}MB` 
                        : '∞'}
                    </span>
                  </div>
                </div>
              )}

              {/* Drag and drop area */}
              <div
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                className={`relative border-2 border-dashed rounded-lg p-3 transition-all ${
                  isDragging 
                    ? 'border-primary-500 bg-primary-50' 
                    : 'border-gray-300 bg-gray-50 hover:border-gray-400'
                } ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <Upload className={`w-8 h-8 ${isDragging ? 'text-primary-600' : 'text-gray-400'}`} />
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {isDragging ? t('upload.dropFilesHere') : t('upload.dragAndDropFiles')}
                      </p>
                      <p className="text-xs text-gray-500">{t('upload.jpgFilesOnly')}</p>
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".jpg,.jpeg,image/jpeg"
                      multiple
                      onChange={handleFileSelect}
                      disabled={uploading}
                      className="hidden"
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                      title={t('upload.selectFiles')}
                      aria-label={t('upload.selectFiles')}
                    >
                      {t('upload.selectFiles')}
                    </button>
                  </div>
                </div>
              </div>

              {/* Selected files list */}
              {selectedFiles.length > 0 && (
                <div className="mt-6">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-900">
                      {t('upload.selectedFiles')} ({selectedFiles.length})
                    </h3>
                    {!uploading && (
                      <button
                        onClick={() => setSelectedFiles([])}
                        className="text-xs text-red-600 hover:text-red-700 font-medium"
                        title={t('upload.clearAll')}
                        aria-label={t('upload.clearAll')}
                      >
                        {t('upload.clearAll')}
                      </button>
                    )}
                  </div>
                  
                  {/* Files list with scroll - native scrollbar */}
                  <div className="max-h-64 overflow-y-auto space-y-2">
                    {selectedFiles.map((fileItem) => (
                      <div
                        key={fileItem.id}
                        className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
                      >
                        <div className="w-12 h-12 bg-gradient-to-br from-blue-100 to-blue-200 rounded-lg flex items-center justify-center flex-shrink-0">
                          <ImageIcon className="w-6 h-6 text-blue-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{fileItem.name}</p>
                          <p className="text-xs text-gray-500">{formatFileSize(fileItem.size)}</p>
                        </div>
                        {!uploading && (
                          <button
                            onClick={() => handleRemoveFile(fileItem.id)}
                            className="p-2 hover:bg-red-100 rounded-lg transition-colors flex-shrink-0"
                            title={t('upload.removeFile')}
                            aria-label={t('upload.removeFile')}
                          >
                            <Trash2 className="w-4 h-4 text-red-600" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Assign moments toggle */}
              <div className="flex items-center justify-between py-3 px-4 bg-gray-50 rounded-lg mt-4">
                <div>
                  <p className="font-medium text-gray-900 text-sm">{t('upload.autoAssignToMoments')}</p>
                  <p className="text-xs text-gray-500">{t('upload.assignImagesToMomentsByCaptureTime')}</p>
                </div>
                <label className="relative inline-flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={assignMoments}
                    onChange={(e) => setAssignMoments(e.target.checked)}
                    disabled={uploading}
                    className="sr-only peer"
                  />
                  <div className={`w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:bg-primary-600 peer-disabled:opacity-50 after:content-[''] after:absolute after:top-[2px] ${
                    isRTL 
                      ? 'after:right-[2px] peer-checked:after:-translate-x-5' 
                      : 'after:left-[2px] peer-checked:after:translate-x-5'
                  } after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all after:border-white`}></div>
                </label>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl flex justify-end gap-3">
              <button
                onClick={onClose}
                disabled={uploading}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                title={uploading ? t('upload.uploading') : t('account.cancelEsc')}
                aria-label={uploading ? t('upload.uploading') : t('account.cancelEsc')}
              >
                {uploading ? t('upload.uploading') : t('account.cancel')}
              </button>
              <button
                onClick={handleStartUpload}
                disabled={uploading || selectedFiles.length === 0}
                className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                title={uploading ? t('upload.processing') : t('upload.startUpload')}
                aria-label={uploading ? t('upload.processing') : t('upload.startUpload')}
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t('upload.processing')}</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    <span>{t('upload.startUpload')}</span>
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}



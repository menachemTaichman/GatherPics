import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Upload, Loader2, Check, AlertCircle, Trash2, Image as ImageIcon, Filter } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useRTL } from '../../hooks/useRTL';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useModalManager } from '../../utils/modalManager';
import { imagesAPI, eventsAPI, uploadsAPI } from '../../utils/apiService';
import { formatErrorMessage } from '../../utils/errorHandler';
import { useToast } from '../../contexts/ToastContext';
import { useApplyScopes, useEventId } from '../../utils/storeUtils';
import { useEventGeneralById } from '../../utils/dataManager';
import { formatDuration } from '../../utils/dateUtils';
import ConfirmDelete from '../modals/ConfirmDelete';

export default function UploadFormModal({ 
  isOpen, 
  onClose, 
  eventUrl, 
  onUploadComplete,
  onUploadSuccess,
  existingUploadId = null
}) {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [assignMoments, setAssignMoments] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadStartTime, setUploadStartTime] = useState(null);
  const [uploadId, setUploadId] = useState(null);
  const [fileToImageMap, setFileToImageMap] = useState({}); // Maps file index to image_id
  const [imageStatuses, setImageStatuses] = useState({}); // Maps image_id to status
  const [existingUploadImages, setExistingUploadImages] = useState([]); // Images from existing upload
  const [existingUploadStatus, setExistingUploadStatus] = useState(null);
  const [loadingExistingUpload, setLoadingExistingUpload] = useState(false);
  const [deletingUnreadyImages, setDeletingUnreadyImages] = useState(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [allImagesUploaded, setAllImagesUploaded] = useState(false);
  const [statusFilter, setStatusFilter] = useState(null); // null = all, or specific status
  const allImagesUploadedRef = useRef(false); // Ref to track upload completion for poll function
  const fileInputRef = useRef(null);
  const dragCounter = useRef(0);
  const timeUpdateIntervalRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const existingPollIntervalRef = useRef(null);
  const { showToast } = useToast();
  const { t } = useTranslation();
  const { isRTL } = useRTL();
  const eventId = useEventId(eventUrl);
  
  // Determine if we're viewing an existing upload (either from prop or after starting upload)
  const isViewingExistingUpload = existingUploadId || uploadId;
  
  // Only fetch event data when not viewing existing upload (to avoid unnecessary fetch)
  useApplyScopes(isOpen && eventId && !isViewingExistingUpload ? [{ entity: 'event', id: String(eventId), eventId: 'general' }] : []);
  const eventData = useEventGeneralById(!isViewingExistingUpload ? eventId : null);
  const eventLimits = useMemo(() => {
    // Don't calculate limits when viewing existing upload
    if (isViewingExistingUpload || !eventData) {
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
  }, [eventData, isViewingExistingUpload]);
  
  const { registerModal, unregisterModal } = useModalManager();
  const modalId = 'upload-form-modal';

  // Custom keyboard handler for Enter and Esc keys
  const handleUploadFormKeys = (e) => {
    if (e.key === 'Enter' && !uploading && selectedFiles.length > 0) {
      e.preventDefault();
      handleStartUpload();
      return true; // Mark as handled
    }
    // Prevent ESC during file upload, allow after files are uploaded (during processing)
    if (e.key === 'Escape') {
      if (uploading && !allImagesUploaded) {
        e.preventDefault();
        return true; // Prevent closing during upload
      }
      // Allow ESC after files are uploaded (processing continues in background)
      e.preventDefault();
      onClose();
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

  // Fetch existing upload images when modal opens with existingUploadId
  useEffect(() => {
    if (isOpen && existingUploadId && eventUrl) {
      setLoadingExistingUpload(true);
      const fetchExistingUpload = async () => {
        try {
          const progress = await imagesAPI.getUploadProgress(existingUploadId, eventUrl);
          setExistingUploadStatus(progress.upload_status);
          setExistingUploadImages(progress.images || []);
          
          // Initialize image statuses from existing upload
          const statuses = {};
          (progress.images || []).forEach(img => {
            statuses[img.image_id] = img.status || 'PENDING_UPLOAD';
          });
          setImageStatuses(statuses);
        } catch (error) {
          console.error('Failed to fetch existing upload:', error);
          showToast(formatErrorMessage('fetch existing upload', error), 'error');
        } finally {
          setLoadingExistingUpload(false);
        }
      };
      fetchExistingUpload();
      
      // Poll for updates if upload is still processing
      const pollExistingUpload = async () => {
        try {
          const progress = await imagesAPI.getUploadProgress(existingUploadId, eventUrl);
          setExistingUploadStatus(progress.upload_status);
          setExistingUploadImages(progress.images || []);
          
          // Update image statuses
          setImageStatuses(prev => {
            const newStatuses = { ...prev };
            (progress.images || []).forEach(img => {
              newStatuses[img.image_id] = img.status || 'PENDING_UPLOAD';
            });
            return newStatuses;
          });
          
          // Stop polling if upload is complete or failed
          if (progress.upload_status === 'COMPLETED' || progress.upload_status === 'FAILED') {
            if (existingPollIntervalRef.current) {
              clearInterval(existingPollIntervalRef.current);
              existingPollIntervalRef.current = null;
            }
          }
        } catch (error) {
          console.error('Failed to poll existing upload:', error);
        }
      };
      
      // Poll every 2 seconds if upload is still processing
      if (existingPollIntervalRef.current) {
        clearInterval(existingPollIntervalRef.current);
      }
      existingPollIntervalRef.current = setInterval(pollExistingUpload, 2000);
      pollExistingUpload(); // Initial poll
      
      return () => {
        if (existingPollIntervalRef.current) {
          clearInterval(existingPollIntervalRef.current);
          existingPollIntervalRef.current = null;
        }
      };
    }
  }, [isOpen, existingUploadId, eventUrl, showToast]);

  // Check if all images are uploaded (fallback check - primary is set via callback from uploadWithProgress)
  useEffect(() => {
    if (!uploading) {
      // Only set to true if we're not uploading AND we don't have any upload in progress
      // This prevents setting it to true when modal first opens
      if (!uploadProgress) {
        setAllImagesUploaded(true);
        allImagesUploadedRef.current = true;
      }
      return;
    }
    
    // If we already set allImagesUploaded via callback, don't override it
    // This is just a fallback check in case the callback didn't fire
    if (allImagesUploadedRef.current) {
      return;
    }
    
    // Fallback: If uploadProgress.step is 'processing' or beyond, uploads are done
    // (Primary check is via callback from uploadWithProgress)
    const isStillUploading = uploadProgress?.step === 'uploading' || uploadProgress?.step === 'preparing';
    
    if (!isStillUploading && uploadProgress?.step) {
      setAllImagesUploaded(true);
      allImagesUploadedRef.current = true;
    }
  }, [existingUploadImages, imageStatuses, uploading, uploadProgress, allImagesUploaded]);

  // Add beforeunload handler to warn about refresh during upload
  useEffect(() => {
    if (!isOpen || !uploading || allImagesUploaded) {
      return;
    }

    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = t('upload.pleaseWaitUntilFilesAreUploaded');
      return e.returnValue;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isOpen, uploading, allImagesUploaded, t]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedFiles([]);
      setUploadProgress(null);
      setUploading(false);
      setIsDragging(false);
      setUploadStartTime(null);
      setUploadId(null);
      setFileToImageMap({});
      setImageStatuses({});
      setExistingUploadImages([]);
      setExistingUploadStatus(null);
      setLoadingExistingUpload(false);
      setDeletingUnreadyImages(false);
      setShowDeleteConfirmModal(false);
      setAllImagesUploaded(false);
      setStatusFilter(null);
      allImagesUploadedRef.current = false;
      if (timeUpdateIntervalRef.current) {
        clearInterval(timeUpdateIntervalRef.current);
        timeUpdateIntervalRef.current = null;
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      if (existingPollIntervalRef.current) {
        clearInterval(existingPollIntervalRef.current);
        existingPollIntervalRef.current = null;
      }
    }
  }, [isOpen]);

  // Cleanup intervals on unmount
  useEffect(() => {
    return () => {
      if (timeUpdateIntervalRef.current) {
        clearInterval(timeUpdateIntervalRef.current);
        timeUpdateIntervalRef.current = null;
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      if (existingPollIntervalRef.current) {
        clearInterval(existingPollIntervalRef.current);
        existingPollIntervalRef.current = null;
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
      'preparing': 2,       // 0-2% (getting presigned URLs)
      'uploading': 10,      // 2-12% (uploading to S3)
      'processing': 88,      // 12-100% (image processing - face detection, clustering, etc.)
      'complete': 100       // 100%
    };
    
    const stepOrder = ['preparing', 'uploading', 'processing', 'complete'];
    const currentStepIndex = stepOrder.indexOf(progress.step);
    
    if (currentStepIndex === -1) return 0;
    
    // Calculate base progress (completed steps)
    let baseProgress = 0;
    for (let i = 0; i < currentStepIndex; i++) {
      baseProgress += stepWeights[stepOrder[i]];
    }
    
    // Calculate progress within current step
    let stepProgress = 0;
    if (progress.total > 0 && progress.current >= 0) {
      const weight = stepWeights[progress.step] || 0;
      stepProgress = (progress.current / progress.total) * weight;
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
    // Reset upload completion status when starting new upload
    setAllImagesUploaded(false);
    allImagesUploadedRef.current = false;
    setUploadProgress({ 
      step: 'preparing', 
      current: 0, 
      total: selectedFiles.length, 
      message: 'Preparing upload...',
      percentage: 0,
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
      
      // Start upload (API handles everything, returns immediately)
      setUploadProgress({ 
        step: 'preparing', 
        current: 0, 
        total: selectedFiles.length, 
        message: 'Preparing upload...',
        percentage: 0,
        elapsedTime: Date.now() - startTime,
        estimatedTimeRemaining: null
      });
      
      // Track when all S3 uploads are complete
      let allS3UploadsComplete = false;
      
      const result = await imagesAPI.uploadWithProgress(
        files, 
        assignMoments, 
        eventUrl,
        (progress) => {
          if (progress.phase === 'uploading') {
            // Update progress during upload
            setUploadProgress({ 
              step: 'uploading', 
              current: progress.completed, 
              total: progress.total, 
              message: progress.message,
              percentage: Math.min(12, 2 + (progress.completed / progress.total) * 10),
              elapsedTime: Date.now() - startTime,
              estimatedTimeRemaining: null
            });
          } else if (progress.phase === 'uploads_complete') {
            // All S3 uploads are complete - safe to close modal now
            allS3UploadsComplete = true;
            allImagesUploadedRef.current = true;
            setAllImagesUploaded(true);
            
            // Update progress to show we're moving to processing
            setUploadProgress({ 
              step: 'processing', 
              current: progress.completed, 
              total: progress.total, 
              message: 'All files uploaded. Processing images...',
              percentage: 12,
              elapsedTime: Date.now() - startTime,
              estimatedTimeRemaining: null
            });
          }
        }
      );
      
      setUploadId(result.upload_id);
      setFileToImageMap(result.file_to_image_map);
      
      // Clear selected files since they're now part of the upload and will appear in existingUploadImages
      setSelectedFiles([]);
      
      // Initialize image statuses - all start as UPLOADING since they're being uploaded
      const initialStatuses = {};
      Object.values(result.file_to_image_map).forEach(imageId => {
        initialStatuses[imageId] = 'UPLOADING';
      });
      setImageStatuses(initialStatuses);
      
      // If uploads completed synchronously (shouldn't happen, but just in case)
      if (allS3UploadsComplete) {
        setAllImagesUploaded(true);
      }
      
      // Start polling for progress
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      
      const pollProgress = async () => {
        try {
          if (!result.upload_id) return;
          
          // Stop polling if upload has failed
          if (pollIntervalRef.current === null) return;
          
          const progress = await imagesAPI.getUploadProgress(result.upload_id, eventUrl);
          const uploadStatus = progress.upload_status;
          const images = progress.images || [];
          
          // Update existing upload images (switch to view existing upload mode)
          setExistingUploadImages(images);
          setExistingUploadStatus(uploadStatus);
          
          // Update image statuses
          setImageStatuses(prev => {
            const newStatuses = { ...prev };
            images.forEach(img => {
              newStatuses[img.image_id] = img.status || 'PENDING_UPLOAD';
            });
            return newStatuses;
          });
          
          // Count images by status
          let totalReady = 0;
          let totalFailed = 0;
          let totalProcessing = 0;
          let totalQueued = 0;
          let totalUploading = 0;
          let totalPendingUpload = 0;
          
          images.forEach(img => {
            const status = img.status || 'PENDING_UPLOAD';
            if (status === 'READY') totalReady++;
            else if (status === 'FAILED') totalFailed++;
            else if (status === 'PROCESSING') totalProcessing++;
            else if (status === 'QUEUED') totalQueued++;
            else if (status === 'UPLOADING') totalUploading++;
            else if (status === 'PENDING_UPLOAD') totalPendingUpload++;
          });
          
          // Determine the current step:
          // - If uploadStatus is COMPLETED, we're in 'complete' step
          // - If we know all S3 uploads are complete (from callback), we're in 'processing' step
          // - Otherwise, if any images are still UPLOADING or PENDING_UPLOAD, we're still in 'uploading' step
          // - Otherwise, we're in 'processing' step
          const stillUploading = totalUploading > 0 || totalPendingUpload > 0;
          let currentStep;
          if (uploadStatus === 'COMPLETED') {
            currentStep = 'complete';
          } else if (allImagesUploadedRef.current) {
            // We know S3 uploads are complete (from callback), so we're processing
            currentStep = 'processing';
          } else if (stillUploading) {
            currentStep = 'uploading';
          } else {
            currentStep = 'processing';
          }
          
          // Calculate overall progress
          const total = images.length;
          const processed = totalReady + totalFailed;
          const percentage = calculateOverallProgress({
            step: currentStep,
            current: totalReady,
            total: total
          });
          
          // Update progress
          setUploadProgress({
            step: currentStep,
            current: totalReady,
            total: total,
            message: uploadStatus === 'COMPLETED' 
              ? `Processing complete: ${totalReady} images processed`
              : stillUploading
              ? `Uploading: ${totalUploading + totalPendingUpload} uploading, ${totalQueued + totalProcessing} queued/processing, ${totalReady} ready, ${totalFailed} failed`
              : `Processing: ${totalReady} ready, ${totalProcessing + totalQueued} processing, ${totalFailed} failed`,
            percentage: percentage,
            elapsedTime: Date.now() - startTime,
            estimatedTimeRemaining: null
          });
          
          // Check if complete
          if (uploadStatus === 'COMPLETED' || uploadStatus === 'FAILED') {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
            
            // Stop time update interval
            if (timeUpdateIntervalRef.current) {
              clearInterval(timeUpdateIntervalRef.current);
              timeUpdateIntervalRef.current = null;
            }
            
            if (uploadStatus === 'COMPLETED') {
              // Get final upload details
              try {
                const uploadDetails = await uploadsAPI.getById(result.upload_id, eventUrl);
                
                let facesCount = 0;
                let clustersCount = 0;
                
                if (uploadDetails.changes) {
                  const uploadChange = uploadDetails.changes.find(
                    change => change.entity === 'upload' && (change.type === 'UPSERT' || change.type === 'UPDATE')
                  );
                  if (uploadChange && uploadChange.items) {
                    const uploadEntity = Object.values(uploadChange.items)[0];
                    facesCount = uploadEntity?.faces_count || 0;
                    clustersCount = uploadEntity?.clusters_count || 0;
                  }
                }
                
                const successMsg = `${t('upload.successfullyProcessed')} ${totalReady} ${totalReady === 1 ? t('upload.image') : t('upload.imagesPlural')}, ${t('upload.detected')} ${facesCount} ${facesCount === 1 ? t('upload.face') : t('upload.facesPlural')}, ${t('upload.created')} ${clustersCount} ${clustersCount === 1 ? t('upload.group') : t('upload.groupsPlural')}`;
                
                setUploadProgress({ 
                  step: 'complete', 
                  current: totalReady, 
                  total: total, 
                  message: successMsg,
                  percentage: 100,
                  elapsedTime: Date.now() - startTime,
                  estimatedTimeRemaining: null
                });
                
                showToast(successMsg, 'success');
                
                if (totalFailed > 0) {
                  showToast(`${totalFailed} ${t('upload.imageFailedToProcess')}`, 'warning');
                }
                
                try {
                  await eventsAPI.getById(eventUrl);
                } catch (refreshError) {
                  console.error('Failed to refresh event data:', refreshError);
                }
                
                if (onUploadComplete) {
                  onUploadComplete({
                    upload_id: result.upload_id,
                    images_processed: totalReady,
                    faces_detected: facesCount,
                    groups_created: clustersCount,
                    errors: totalFailed > 0 ? [`${totalFailed} images failed to process`] : []
                  });
                }
                
                setTimeout(() => {
                  if (onUploadSuccess && result.upload_id) {
                    onUploadSuccess(result.upload_id);
                  }
                  onClose();
                }, 2000);
              } catch (error) {
                console.error('Failed to get final upload details:', error);
              }
            } else {
              setUploadProgress({ 
                step: 'error', 
                current: 0, 
                total: 0, 
                message: `Upload failed: ${uploadStatus}`, 
                percentage: 0,
                elapsedTime: Date.now() - startTime,
                estimatedTimeRemaining: null
              });
              setUploading(false);
            }
          }
        } catch (error) {
          console.error('Failed to poll progress:', error);
          // Stop polling on error
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          // Stop time update interval
          if (timeUpdateIntervalRef.current) {
            clearInterval(timeUpdateIntervalRef.current);
            timeUpdateIntervalRef.current = null;
          }
          setUploading(false);
        }
      };
      
      // Poll every 2 seconds
      pollIntervalRef.current = setInterval(pollProgress, 2000);
      pollProgress(); // Initial poll

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
      
      // Clear intervals
      if (timeUpdateIntervalRef.current) {
        clearInterval(timeUpdateIntervalRef.current);
        timeUpdateIntervalRef.current = null;
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // Count failed images
  const failedImagesCount = useMemo(() => {
    return existingUploadImages.filter(img => {
      const status = img.status || 'PENDING_UPLOAD';
      return status === 'FAILED';
    }).length;
  }, [existingUploadImages]);

  // Filter images by status
  const filteredExistingUploadImages = useMemo(() => {
    if (!statusFilter) return existingUploadImages;
    return existingUploadImages.filter(img => {
      const status = img.status || 'PENDING_UPLOAD';
      return status === statusFilter;
    });
  }, [existingUploadImages, statusFilter]);

  const filteredSelectedFiles = useMemo(() => {
    if (!statusFilter) return selectedFiles;
    return selectedFiles.filter((fileItem, index) => {
      const imageId = fileToImageMap[index];
      const status = imageId ? (imageStatuses[imageId] || 'PENDING_UPLOAD') : (uploading ? 'UPLOADING' : null);
      return status === statusFilter;
    });
  }, [selectedFiles, fileToImageMap, imageStatuses, statusFilter, uploading]);

  // Get available statuses from images
  const availableStatuses = useMemo(() => {
    const statusSet = new Set();
    existingUploadImages.forEach(img => {
      const status = img.status || 'PENDING_UPLOAD';
      statusSet.add(status);
    });
    selectedFiles.forEach((fileItem, index) => {
      const imageId = fileToImageMap[index];
      const status = imageId ? (imageStatuses[imageId] || 'PENDING_UPLOAD') : (uploading ? 'UPLOADING' : null);
      if (status) statusSet.add(status);
    });
    return Array.from(statusSet).sort();
  }, [existingUploadImages, selectedFiles, fileToImageMap, imageStatuses, uploading]);

  // Handle delete unready images confirmation
  const handleDeleteUnreadyImagesClick = () => {
    setShowDeleteConfirmModal(true);
  };

  // Handle delete unready images (called after confirmation)
  const handleDeleteUnreadyImages = async () => {
    const currentUploadId = existingUploadId || uploadId;
    if (!currentUploadId || !eventUrl) return;

    setDeletingUnreadyImages(true);
    try {
      await uploadsAPI.deleteUnreadyImages(currentUploadId, eventUrl);
      
      // Refresh upload progress to update the images list
      const progress = await imagesAPI.getUploadProgress(currentUploadId, eventUrl);
      setExistingUploadImages(progress.images || []);
      setExistingUploadStatus(progress.upload_status);
      
      // Update image statuses
      setImageStatuses(prev => {
        const newStatuses = { ...prev };
        (progress.images || []).forEach(img => {
          newStatuses[img.image_id] = img.status || 'PENDING_UPLOAD';
        });
        return newStatuses;
      });
      
      showToast(t('upload.failedImagesDeleted', { count: failedImagesCount }), 'success');
      
      // Refresh event data
      try {
        await eventsAPI.getById(eventUrl);
      } catch (refreshError) {
        console.error('Failed to refresh event data:', refreshError);
      }
    } catch (error) {
      console.error('Failed to delete unready images:', error);
      showToast(formatErrorMessage('delete failed images', error), 'error');
    } finally {
      setDeletingUnreadyImages(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div 
          key="upload-modal"
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (!uploading || allImagesUploaded) {
              onClose();
            }
          }}
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
                onClick={() => {
                  if (!uploading || allImagesUploaded) {
                    onClose();
                  }
                }}
                disabled={uploading && !allImagesUploaded}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={
                  uploading && !allImagesUploaded
                    ? t('upload.pleaseWaitUntilFilesAreUploaded')
                    : uploading 
                      ? t('upload.closeProcessingWillContinue') 
                      : t('account.cancelEsc')
                }
                aria-label={
                  uploading && !allImagesUploaded
                    ? t('upload.pleaseWaitUntilFilesAreUploaded')
                    : uploading 
                      ? t('upload.closeProcessingWillContinue') 
                      : t('account.cancelEsc')
                }
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Upload progress - moved to top */}
            <AnimatePresence>
              {uploadProgress && (
                <motion.div 
                  key="upload-progress"
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
                        {/* Info message about leaving */}
                        {uploadProgress.step !== 'complete' && uploadProgress.step !== 'error' && (
                          <div className="mt-2 text-xs text-gray-500 italic">
                            {uploading && !allImagesUploaded ? (
                              t('upload.pleaseWaitUntilFilesAreUploaded')
                            ) : (
                              t('upload.youCanLeaveProcessingWillContinue')
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

              {/* Drag and drop area - only show when not viewing existing upload */}
              {!isViewingExistingUpload && (
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
              )}

              {/* Unified images list - shows both existing upload images and newly selected files */}
              <div className="mt-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-900">
                    {isViewingExistingUpload ? t('uploadDetail.uploadDetails') : t('upload.selectedFiles')} (
                      {statusFilter 
                        ? `${filteredExistingUploadImages.length + filteredSelectedFiles.length} / ${existingUploadImages.length + selectedFiles.length}`
                        : existingUploadImages.length + selectedFiles.length
                      })
                  </h3>
                  <div className="flex items-center gap-2">
                    {/* Status filter dropdown */}
                    {(existingUploadImages.length > 0 || selectedFiles.length > 0) && availableStatuses.length > 0 && (
                      <div className="flex items-center gap-2">
                        <Filter className="w-4 h-4 text-gray-500" />
                        <select
                          value={statusFilter || 'all'}
                          onChange={(e) => setStatusFilter(e.target.value === 'all' ? null : e.target.value)}
                          className="text-xs border border-gray-300 rounded-lg px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          title={t('upload.filterByStatus')}
                          aria-label={t('upload.filterByStatus')}
                        >
                          <option value="all">{t('upload.allStatuses')}</option>
                          {availableStatuses.map(status => {
                            const getStatusLabel = (s) => {
                              switch (s) {
                                case 'UPLOADING': return t('upload.uploading');
                                case 'PENDING_UPLOAD': return t('upload.pending');
                                case 'QUEUED': return t('upload.queued');
                                case 'PROCESSING': return t('upload.processing');
                                case 'READY': return t('upload.ready');
                                case 'FAILED': return t('upload.failed');
                                default: return s;
                              }
                            };
                            return (
                              <option key={status} value={status}>
                                {getStatusLabel(status)}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    )}
                    {existingUploadStatus && (
                      <span className={`text-xs font-medium px-2 py-1 rounded ${
                        existingUploadStatus === 'COMPLETED' 
                          ? 'bg-green-100 text-green-700'
                          : existingUploadStatus === 'FAILED'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-blue-100 text-blue-700'
                      }`}>
                        {existingUploadStatus === 'COMPLETED' ? t('upload.successfullyProcessed') : 
                         existingUploadStatus === 'FAILED' ? t('upload.imageFailedToProcess') :
                         t('upload.processing')}
                      </span>
                    )}
                    {isViewingExistingUpload && existingUploadStatus === 'COMPLETED' && failedImagesCount > 0 && (
                      <button
                        onClick={handleDeleteUnreadyImagesClick}
                        disabled={deletingUnreadyImages}
                        className="text-xs text-red-600 hover:text-red-700 font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                        title={t('upload.deleteFailedImages', { count: failedImagesCount })}
                        aria-label={t('upload.deleteFailedImages', { count: failedImagesCount })}
                      >
                        {deletingUnreadyImages ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>{t('upload.deleting')}</span>
                          </>
                        ) : (
                          <>
                            <Trash2 className="w-3 h-3" />
                            <span>{t('upload.deleteFailedImages', { count: failedImagesCount })}</span>
                          </>
                        )}
                      </button>
                    )}
                    {!isViewingExistingUpload && !uploading && selectedFiles.length > 0 && (
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
                </div>
                
                {loadingExistingUpload && isViewingExistingUpload ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                  </div>
                ) : (existingUploadImages.length === 0 && selectedFiles.length === 0) ? (
                  <div className="border rounded-lg p-3 bg-gray-50">
                    <p className="text-sm text-gray-500 text-center py-4">{t('uploadDetail.noImagesInThisUpload')}</p>
                  </div>
                ) : (filteredExistingUploadImages.length === 0 && filteredSelectedFiles.length === 0) ? (
                  <div className="border rounded-lg p-3 bg-gray-50">
                    <p className="text-sm text-gray-500 text-center py-4">{t('upload.noImagesWithSelectedStatus')}</p>
                  </div>
                ) : (
                  <div className="max-h-64 overflow-y-auto space-y-2 border rounded-lg p-3 bg-gray-50">
                      {/* Helper function for status info */}
                      {(() => {
                        const getStatusInfo = (status) => {
                          switch (status) {
                            case 'UPLOADING':
                              return { color: 'text-blue-500', bg: 'bg-blue-100', icon: Upload, label: 'Uploading...', spinning: false };
                            case 'PENDING_UPLOAD':
                              return { color: 'text-gray-500', bg: 'bg-gray-100', icon: Upload, label: 'Pending' };
                            case 'QUEUED':
                              return { color: 'text-yellow-600', bg: 'bg-yellow-100', icon: Loader2, label: 'Queued', spinning: true };
                            case 'PROCESSING':
                              return { color: 'text-blue-600', bg: 'bg-blue-100', icon: Loader2, label: 'Processing', spinning: true };
                            case 'READY':
                              return { color: 'text-green-600', bg: 'bg-green-100', icon: Check, label: 'Ready' };
                            case 'FAILED':
                              return { color: 'text-red-600', bg: 'bg-red-100', icon: AlertCircle, label: 'Failed' };
                            default:
                              return { color: 'text-gray-500', bg: 'bg-gray-100', icon: ImageIcon, label: 'Waiting' };
                          }
                        };

                        return (
                          <>
                            {/* Existing upload images */}
                            {filteredExistingUploadImages.map((img) => {
                              const status = img.status || 'PENDING_UPLOAD';
                              const statusInfo = getStatusInfo(status);
                              const StatusIcon = statusInfo.icon;
                              
                              return (
                                <div
                                  key={img.image_id}
                                  className={`flex items-center gap-3 p-3 bg-white border rounded-lg transition-colors ${
                                    status === 'READY' 
                                      ? 'border-green-300 bg-green-50' 
                                      : status === 'FAILED'
                                      ? 'border-red-300 bg-red-50'
                                      : status === 'PROCESSING' || status === 'QUEUED'
                                      ? 'border-blue-300 bg-blue-50'
                                      : 'border-gray-200'
                                  }`}
                                >
                                  <div className={`w-12 h-12 ${statusInfo.bg} rounded-lg flex items-center justify-center flex-shrink-0`}>
                                    <StatusIcon className={`w-6 h-6 ${statusInfo.color} ${statusInfo.spinning ? 'animate-spin' : ''}`} />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <p className="text-sm font-medium text-gray-900 truncate">{img.label || img.image_id}</p>
                                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${statusInfo.bg} ${statusInfo.color}`}>
                                        {statusInfo.label}
                                      </span>
                                    </div>
                                    <p className="text-xs text-gray-500">ID: {img.image_id}</p>
                                  </div>
                                </div>
                              );
                            })}
                            
                            {/* Newly selected files */}
                            {filteredSelectedFiles.map((fileItem) => {
                              // Find the original index in selectedFiles to get the correct imageId
                              const originalIndex = selectedFiles.findIndex(f => f.id === fileItem.id);
                              const imageId = originalIndex !== -1 ? fileToImageMap[originalIndex] : null;
                              const status = imageId ? (imageStatuses[imageId] || 'PENDING_UPLOAD') : (uploading ? 'UPLOADING' : null);
                              const statusInfo = status ? getStatusInfo(status) : { color: 'text-gray-500', bg: 'bg-gray-100', icon: ImageIcon, label: 'Waiting' };
                              const StatusIcon = statusInfo.icon;
                              
                              return (
                                <div
                                  key={fileItem.id}
                                  className={`flex items-center gap-3 p-3 bg-white border rounded-lg transition-colors ${
                                    status === 'READY' 
                                      ? 'border-green-300 bg-green-50' 
                                      : status === 'FAILED'
                                      ? 'border-red-300 bg-red-50'
                                      : status === 'PROCESSING' || status === 'QUEUED' || status === 'UPLOADING'
                                      ? 'border-blue-300 bg-blue-50'
                                      : 'border-gray-200 hover:border-gray-300'
                                  }`}
                                >
                                  <div className={`w-12 h-12 ${statusInfo.bg} rounded-lg flex items-center justify-center flex-shrink-0`}>
                                    <StatusIcon className={`w-6 h-6 ${statusInfo.color} ${statusInfo.spinning ? 'animate-spin' : ''}`} />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <p className="text-sm font-medium text-gray-900 truncate">{fileItem.name}</p>
                                      {status && (
                                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${statusInfo.bg} ${statusInfo.color}`}>
                                          {statusInfo.label}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-xs text-gray-500">{formatFileSize(fileItem.size)}</p>
                                  </div>
                                  {!uploading && !isViewingExistingUpload && (
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
                              );
                            })}
                          </>
                        );
                      })()}
                  </div>
                )}
              </div>

              {/* Assign moments toggle - only show when not viewing existing upload */}
              {!isViewingExistingUpload && (
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
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl flex justify-end gap-3">
              <button
                onClick={() => {
                  if (!uploading || allImagesUploaded) {
                    onClose();
                  }
                }}
                disabled={uploading && !allImagesUploaded}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                title={
                  uploading && !allImagesUploaded
                    ? t('upload.pleaseWaitUntilFilesAreUploaded')
                    : uploading 
                      ? t('upload.closeProcessingWillContinue') 
                      : t('account.cancelEsc')
                }
                aria-label={
                  uploading && !allImagesUploaded
                    ? t('upload.pleaseWaitUntilFilesAreUploaded')
                    : uploading 
                      ? t('upload.closeProcessingWillContinue') 
                      : t('account.cancelEsc')
                }
              >
                {uploading && !allImagesUploaded
                  ? t('upload.pleaseWait')
                  : uploading 
                    ? t('account.close') 
                    : t('account.cancel')}
              </button>
              {!isViewingExistingUpload && (
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
              )}
            </div>
          </motion.div>
        </div>
      )}
      
      {/* Confirm Delete Modal */}
      {showDeleteConfirmModal && (
        <ConfirmDelete
          key="delete-confirm"
          isOpen={showDeleteConfirmModal}
          onClose={() => setShowDeleteConfirmModal(false)}
          onConfirm={handleDeleteUnreadyImages}
          title={t('upload.deleteFailedImagesTitle')}
          message={t('upload.confirmDeleteFailedImages')}
          itemName={t('upload.failedImagesCount', { count: failedImagesCount })}
          confirmText={t('confirmDelete.delete')}
          cancelText={t('confirmDelete.cancel')}
          simpleMessage={false}
        />
      )}
    </AnimatePresence>
  );
}



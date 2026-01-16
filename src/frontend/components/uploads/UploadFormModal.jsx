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
import { useEventGeneralById, useDataStore } from '../../utils/dataManager';
import { formatDuration } from '../../utils/dateUtils';
import ConfirmDelete from '../modals/ConfirmDelete';
import AbsoluteMasonryGrid from '../images/AbsoluteMasonryGrid';
import { LongPressHoverButton } from '../common';

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
  const uploadedCountRef = useRef({ completed: 0, total: 0 }); // Track upload count from callback
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
    const targetTagName = e.target.tagName?.toLowerCase();
    
    // Handle button elements - prevent Enter from triggering toggle buttons, route to save instead
    if (targetTagName === 'button') {
      // Check if this is the save button using data attribute
      const isSaveButton = e.target.dataset?.isSaveButton === 'true';
      
      // Allow save button to work normally
      if (isSaveButton && e.key === 'Enter') {
        return false; // Let the button's onClick handle it
      }
      // For other buttons (like toggles), prevent Enter from triggering them
      // Instead, trigger upload if conditions are met
      if (e.key === 'Enter' && !uploading && selectedFiles.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        handleStartUpload();
        return true;
      }
      // For ESC key, return false to let useModalFocus handle closing the modal
      if (e.key === 'Escape') {
        // Prevent ESC during file upload, allow after files are uploaded (during processing)
        if (uploading && !allImagesUploaded) {
          e.preventDefault();
          return true; // Prevent closing during upload
        }
        return false; // Let useModalFocus handle closing
      }
      // For other keys on buttons, allow default behavior
      return true;
    }
    
    // Allow all normal input behavior for input, textarea, and select elements
    if (targetTagName === 'input' || targetTagName === 'textarea' || targetTagName === 'select') {
      // For Enter key, trigger upload if conditions are met
      if (e.key === 'Enter' && !uploading && selectedFiles.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        handleStartUpload();
        return true;
      }
      // For ESC key, return false to let useModalFocus handle closing the modal
      if (e.key === 'Escape') {
        // Prevent ESC during file upload, allow after files are uploaded (during processing)
        if (uploading && !allImagesUploaded) {
          e.preventDefault();
          return true; // Prevent closing during upload
        }
        return false; // Let useModalFocus handle closing
      }
      // Return true to signal that we're handling this, preventing useModalFocus from stopping it
      return true;
    }
    
    return false; // Let default modal behavior handle it (ESC to close)
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

  // Helper to calculate progress from images array
  const calculateProgressFromImages = useCallback((images, uploadStatus, startTime = null) => {
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
    
    // Use callback's upload count if available (more accurate during upload phase)
    const callbackUploadCount = uploadedCountRef.current;
    const stillUploadingFromCallback = callbackUploadCount.total > 0 && callbackUploadCount.completed < callbackUploadCount.total;
    const stillUploadingFromImages = totalUploading > 0 || totalPendingUpload > 0;
    const stillUploading = stillUploadingFromCallback || stillUploadingFromImages;
    
    let currentStep;
    if (uploadStatus === 'COMPLETED') {
      currentStep = 'complete';
    } else if (uploadStatus === 'FAILED') {
      currentStep = 'error';
    } else if (uploadStatus === 'CLUSTERING_FACES') {
      currentStep = 'clustering';
    } else if (allImagesUploadedRef.current) {
      currentStep = 'processing';
    } else if (stillUploading) {
      currentStep = 'uploading';
    } else {
      currentStep = 'processing';
    }
    
    const total = images.length;
    const percentage = calculateOverallProgress({
      step: currentStep,
      current: totalReady,
      total: total
    });
    
    const elapsedTime = startTime ? Date.now() - startTime : 0;
    
    // Build message - use callback's upload count for more accurate upload progress
    // Use consistent format: "Status | Uploaded X/Y | Processing: N | Ready: Z | Failed: M"
    let message;
    if (uploadStatus === 'COMPLETED') {
      message = `Complete | Ready: ${totalReady} | Failed: ${totalFailed}`;
    } else if (uploadStatus === 'CLUSTERING_FACES') {
      message = `${t('upload.clusteringFaces')} | Processing: ${totalProcessing + totalQueued} | Ready: ${totalReady} | Failed: ${totalFailed}`;
    } else if (currentStep === 'uploading') {
      // Use callback count for upload progress (more accurate)
      const uploadedCount = callbackUploadCount.total > 0 ? callbackUploadCount.completed : (total - totalUploading - totalPendingUpload);
      const uploadTotal = callbackUploadCount.total > 0 ? callbackUploadCount.total : total;
      message = `Uploaded: ${uploadedCount}/${uploadTotal} | Processing: ${totalProcessing + totalQueued} | Ready: ${totalReady} | Failed: ${totalFailed}`;
    } else if (currentStep === 'processing') {
      // All images uploaded, now processing
      message = `${t('upload.processingImages')} | Processing: ${totalProcessing + totalQueued} | Ready: ${totalReady} | Failed: ${totalFailed}`;
    } else {
      message = `Uploaded: ${total}/${total} | Processing: ${totalProcessing + totalQueued} | Ready: ${totalReady} | Failed: ${totalFailed}`;
    }
    
    return {
      step: currentStep,
      current: totalReady,
      total: total,
      message: message,
      percentage: percentage,
      elapsedTime: elapsedTime,
      estimatedTimeRemaining: null,
      totalReady,
      totalFailed,
      totalProcessing,
      totalQueued
    };
  }, [t]);

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
          
          // Set upload progress for in-progress uploads
          if (progress.upload_status !== 'COMPLETED' && progress.upload_status !== 'FAILED') {
            // For existing uploads, all files are already uploaded
            allImagesUploadedRef.current = true;
            setAllImagesUploaded(true);
            const progressData = calculateProgressFromImages(progress.images || [], progress.upload_status);
            setUploadProgress(progressData);
          }
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
          
          // Update progress for in-progress uploads
          if (progress.upload_status !== 'COMPLETED' && progress.upload_status !== 'FAILED') {
            const progressData = calculateProgressFromImages(progress.images || [], progress.upload_status);
            setUploadProgress(progressData);
          }
          
          // Stop polling if upload is complete or failed
          if (progress.upload_status === 'COMPLETED' || progress.upload_status === 'FAILED') {
            if (existingPollIntervalRef.current) {
              clearInterval(existingPollIntervalRef.current);
              existingPollIntervalRef.current = null;
            }
            // Update final progress state
            const progressData = calculateProgressFromImages(progress.images || [], progress.upload_status);
            setUploadProgress(progressData);
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
  }, [isOpen, existingUploadId, eventUrl, showToast, calculateProgressFromImages]);

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
      uploadedCountRef.current = { completed: 0, total: 0 };
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
      'processing': 70,     // 12-82% (image processing - face detection, etc.)
      'clustering': 18,     // 82-100% (clustering faces)
      'complete': 100       // 100%
    };
    
    const stepOrder = ['preparing', 'uploading', 'processing', 'clustering', 'complete'];
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
    uploadedCountRef.current = { completed: 0, total: selectedFiles.length };
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
      let currentUploadId = null;
      
      // Define pollProgress function before starting upload so we can use it immediately
      const pollProgress = async () => {
        try {
          if (!currentUploadId) return;
          
          // Stop polling if already stopped
          if (pollIntervalRef.current === null) return;
          
          const progress = await imagesAPI.getUploadProgress(currentUploadId, eventUrl);
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
          
          // Use shared helper to calculate progress (uses uploadedCountRef for accurate upload count)
          const progressData = calculateProgressFromImages(images, uploadStatus, startTime);
          setUploadProgress(progressData);
          
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
              // Get final upload details and wait for store to update
              try {
                await uploadsAPI.getById(currentUploadId, eventUrl);
                
                // Wait a bit for the store to process the changes
                await new Promise(resolve => setTimeout(resolve, 100));
                
                // Get upload from store directly (like UploadsGalleryPage does)
                const storeState = useDataStore.getState();
                const uploadEntity = eventId && currentUploadId 
                  ? storeState.entities?.[eventId]?.uploads?.[currentUploadId] || null
                  : null;
                
                const facesCount = uploadEntity?.faces_count || 0;
                const groupsCount = uploadEntity?.groups_count || 0;
                
                const successMsg = `${t('upload.successfullyProcessed')} ${progressData.totalReady} ${progressData.totalReady === 1 ? t('upload.image') : t('upload.imagesPlural')}, ${t('upload.detected')} ${facesCount} ${facesCount === 1 ? t('upload.face') : t('upload.facesPlural')}, ${t('upload.created')} ${groupsCount} ${groupsCount === 1 ? t('upload.group') : t('upload.groupsPlural')}`;
                
                setUploadProgress({ 
                  step: 'complete', 
                  current: progressData.totalReady, 
                  total: progressData.total, 
                  message: successMsg,
                  percentage: 100,
                  elapsedTime: Date.now() - startTime,
                  estimatedTimeRemaining: null
                });
                
                showToast(successMsg, 'success');
                
                if (progressData.totalFailed > 0) {
                  showToast(`${progressData.totalFailed} ${t('upload.imageFailedToProcess')}`, 'warning');
                }
                
                try {
                  await eventsAPI.getById(eventUrl);
                } catch (refreshError) {
                  console.error('Failed to refresh event data:', refreshError);
                }
                
                if (onUploadComplete) {
                  onUploadComplete({
                    upload_id: result.upload_id,
                    images_processed: progressData.totalReady,
                    faces_detected: facesCount,
                    groups_created: groupsCount,
                    errors: progressData.totalFailed > 0 ? [`${progressData.totalFailed} images failed to process`] : []
                  });
                }
                
                setTimeout(() => {
                  if (onUploadSuccess && currentUploadId) {
                    onUploadSuccess(currentUploadId);
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
      
      // Start upload and get upload_id immediately to start polling
      const result = await imagesAPI.uploadWithProgress(
        files, 
        assignMoments, 
        eventUrl,
        (progress) => {
          // Store upload_id as soon as we get it from init phase
          if (progress.phase === 'init' && progress.upload_id) {
            currentUploadId = progress.upload_id;
            setUploadId(progress.upload_id);
            
            // Start polling immediately when we have upload_id
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
            }
            pollIntervalRef.current = setInterval(pollProgress, 2000);
            pollProgress(); // Initial poll
          } else if (progress.phase === 'uploading') {
            // Only update the upload count ref - polling will use this for accurate count
            uploadedCountRef.current = { completed: progress.completed, total: progress.total };
          } else if (progress.phase === 'uploads_complete') {
            // All S3 uploads are complete - safe to close modal now
            allS3UploadsComplete = true;
            allImagesUploadedRef.current = true;
            setAllImagesUploaded(true);
            // Clear upload count ref since uploads are done
            uploadedCountRef.current = { completed: progress.total, total: progress.total };
          }
        }
      );
      
      // Ensure we have upload_id (fallback in case init phase didn't provide it)
      if (!currentUploadId && result.upload_id) {
        currentUploadId = result.upload_id;
        setUploadId(result.upload_id);
        
        // Start polling if not already started
        if (!pollIntervalRef.current) {
          pollIntervalRef.current = setInterval(pollProgress, 2000);
          pollProgress(); // Initial poll
        }
      }
      
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

  // Convert to items format for AbsoluteMasonryGrid list layout
  const listItems = useMemo(() => {
    const items = [];
    // Add existing upload images
    filteredExistingUploadImages.forEach(img => {
      items.push({
        id: `existing-${img.image_id}`,
        type: 'existing',
        data: img
      });
    });
    // Add selected files
    filteredSelectedFiles.forEach((fileItem) => {
      const originalIndex = selectedFiles.findIndex(f => f.id === fileItem.id);
      const imageId = originalIndex !== -1 ? fileToImageMap[originalIndex] : null;
      items.push({
        id: `file-${fileItem.id}`,
        type: 'file',
        data: fileItem,
        imageId,
        originalIndex
      });
    });
    return items;
  }, [filteredExistingUploadImages, filteredSelectedFiles, selectedFiles, fileToImageMap]);

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
                type="button"
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
              {uploadProgress && (uploading || (existingUploadId && existingUploadStatus && existingUploadStatus !== 'COMPLETED' && existingUploadStatus !== 'FAILED')) && (
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
                            {uploadProgress.message || 'Processing...'}
                          </p>
                          <span className="text-xs font-semibold text-blue-600 flex-shrink-0 min-w-[3rem] text-right">
                            {uploadProgress.step === 'complete' 
                              ? '100%'
                              : uploadProgress.step === 'error'
                              ? '0%'
                              : uploadProgress.percentage !== undefined
                              ? `${Math.round(uploadProgress.percentage)}%`
                              : '0%'}
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                          <div
                            className={`h-2 rounded-full transition-all duration-300 ${
                              uploadProgress.step === 'complete'
                                ? 'bg-green-600'
                                : uploadProgress.step === 'error'
                                ? 'bg-red-600'
                                : 'bg-blue-600'
                            }`}
                            style={{ width: `${uploadProgress.step === 'complete' ? 100 : uploadProgress.percentage !== undefined ? (uploadProgress.percentage || 0) : 0}%` }}
                          />
                        </div>
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

            {/* Note about data changes - only show after upload completed/failed */}
            {(existingUploadStatus === 'COMPLETED' || existingUploadStatus === 'FAILED' || (uploadProgress && (uploadProgress.step === 'complete' || uploadProgress.step === 'error'))) && (
              <div className="px-6 py-2 border-b border-gray-200">
                <div className="text-xs text-gray-500 italic text-center">
                  {t('uploadDetail.dataMayHaveChanged')}
                </div>
              </div>
            )}

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
                      <LongPressHoverButton
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                        title={t('upload.selectFiles')}
                        aria-label={t('upload.selectFiles')}
                      >
                        {t('upload.selectFiles')}
                      </LongPressHoverButton>
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
                         existingUploadStatus === 'FAILED' ? (
                           failedImagesCount > 0 
                             ? t('upload.imageFailedToProcess')
                             : t('upload.uploadFailed')
                         ) :
                         existingUploadStatus === 'CLUSTERING_FACES' ? t('upload.clusteringFaces') :
                         t('upload.processing')}
                      </span>
                    )}
                    {isViewingExistingUpload && (existingUploadStatus === 'COMPLETED' || existingUploadStatus === 'FAILED') && failedImagesCount > 0 && (
                      <button
                        type="button"
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
                        type="button"
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
                  <div className="border rounded-lg bg-gray-50" style={{ height: '256px', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ flex: 1, overflow: 'hidden', padding: '12px' }}>
                      <AbsoluteMasonryGrid
                        items={listItems}
                        isListLayout={true}
                        listItemHeight={80}
                        gap={8}
                        containerHeight="100%"
                        className="w-full"
                      renderItem={(item) => {
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

                        if (item.type === 'existing') {
                          const img = item.data;
                          const status = img.status || 'PENDING_UPLOAD';
                          const statusInfo = getStatusInfo(status);
                          const StatusIcon = statusInfo.icon;
                          
                          return (
                            <div
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
                        } else {
                          // file type
                          const fileItem = item.data;
                          const status = item.imageId ? (imageStatuses[item.imageId] || 'PENDING_UPLOAD') : (uploading ? 'UPLOADING' : null);
                          const statusInfo = status ? getStatusInfo(status) : { color: 'text-gray-500', bg: 'bg-gray-100', icon: ImageIcon, label: 'Waiting' };
                          const StatusIcon = statusInfo.icon;
                          
                          return (
                            <div
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
                                  type="button"
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
                        }
                      }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Assign moments toggle - only show when not viewing existing upload */}
              {!isViewingExistingUpload && (
                <div className="flex items-center justify-between rounded-lg bg-white px-4 py-3 mt-4">
                  <div>
                    <p className="font-medium text-gray-900">{t('upload.autoAssignToMoments')}</p>
                    <p className="text-sm text-gray-500">{t('upload.assignImagesToMomentsByCaptureTime')}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (uploading) return;
                      setAssignMoments(!assignMoments);
                    }}
                    disabled={uploading}
                    className={`w-10 h-6 rounded-full relative transition-colors ${assignMoments ? 'bg-blue-600' : 'bg-gray-300'} ${uploading ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                    aria-pressed={assignMoments}
                  >
                    <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${isRTL ? 'right-0.5' : 'left-0.5'} ${assignMoments ? (isRTL ? '-translate-x-4' : 'translate-x-4') : ''}`} />
                  </button>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl flex justify-end gap-3">
              <button
                type="button"
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
                  type="button"
                  data-is-save-button="true"
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



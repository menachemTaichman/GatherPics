import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { MessageSquare, Trash2, CheckCircle, XCircle, Clock, Trash, ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { feedbacksAPI } from '../../utils/apiService';
import { useToast } from '../../contexts/ToastContext';
import { useFeedbacksList } from '../../utils/dataManager';
import { useApplyScopes } from '../../utils/storeUtils';
import { getPreference, setPreference } from '../../utils/settings';
import { formatErrorMessage } from '../../utils/errorHandler';
import { ConfirmDelete } from '../../components/modals';
import { FeedbackDetailModal } from '../../components/feedbacks';
import { useAuth } from '../../contexts/authContext';
import { LoginModal } from '../../components/auth';
import { useAuthRefresh } from '../../hooks/useAuthRefresh';
import useFeedbackViewerController from '../../hooks/useFeedbackViewerController';
import { TopNavigationBar } from '../../components/layout';
import { ScrollableTable } from '../../components/common';
import { APP_CONFIG } from '../../config/appConfig';
import { formatDateTimeLocale } from '../../utils/dateUtils';
import { useRTL } from '../../hooks/useRTL';

export default function FeedbacksGalleryPage() {
  const { isAuthenticated, isLoading, showLoginModal, loginError, login, closeLoginModal, openLoginModal } = useAuth();
  const { t } = useTranslation();
  const { isRTL } = useRTL();
  const [deleteFeedback, setDeleteFeedback] = useState(null);
  const [deleteAll, setDeleteAll] = useState(false);
  const [sortBy, setSortBy] = useState(() => getPreference('FeedbacksGallery.sortBy', 'created_at'));
  const [sortDir, setSortDir] = useState(() => getPreference('FeedbacksGallery.sortDir', 'desc'));
  const [filterStatus, setFilterStatus] = useState(() => getPreference('FeedbacksGallery.filterStatus', 'all'));
  
  const { showToast } = useToast();

  // Set document title
  useEffect(() => {
    document.title = `${t('feedbacksGallery.feedbacks')} | ${APP_CONFIG.name}`;
  }, [i18n.language]);

  // Auto-show login modal when not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      openLoginModal();
    }
  }, [isAuthenticated, isLoading, openLoginModal]);
  
  // Initialize Feedback Viewer controller
  const { isOpen: viewerOpen, open: openViewer, viewerProps } = useFeedbackViewerController({
    showToast,
    defaultSortBy: sortBy,
    defaultSortOrder: sortDir,
    filterStatus: filterStatus,
  });

  // Apply scopes for feedbacks (general database)
  useApplyScopes([{ entity: 'all', id: 'feedbacks', eventId: 'general' }]);

  const storeFeedbacks = useFeedbacksList();

  // Create placeholder feedbacks when not authenticated
  const placeholderFeedbacks = useMemo(() => {
    return Array.from({ length: 5 }, (_, i) => ({
      feedback_id: `placeholder-${i}`,
      sender_name: '',
      message: '',
      created_at: null,
      is_closed: 0,
      isPlaceholder: true
    }));
  }, []);

  // Fetch feedbacks data with auto-refresh on auth changes
  const loadFeedbacks = useCallback(async () => {
    try {
      await feedbacksAPI.getAll();
    } catch (e) {
      console.error('Failed to load feedbacks', e);
    }
  }, []);
  
  useAuthRefresh(loadFeedbacks, []);

  // Use feedbacks from store or placeholders when not authenticated
  const currentFeedbacks = isAuthenticated ? storeFeedbacks : placeholderFeedbacks;

  const handleViewFeedback = (feedback, index) => {
    // Find the index in the sorted array to ensure correct navigation
    const feedbackId = feedback.feedback_id || feedback.id;
    const actualIndex = sortedFeedbacks.findIndex(f => (f.feedback_id || f.id) === feedbackId);
    const finalIndex = actualIndex >= 0 ? actualIndex : (index >= 0 ? index : 0);
    
    openViewer({
      index: finalIndex,
      sortBy,
      sortOrder: sortDir,
      filterStatus,
    });
  };

  const handleDeleteFeedback = (feedback) => {
    setDeleteFeedback(feedback);
  };

  const handleConfirmDelete = async () => {
    if (!deleteFeedback) return;

    try {
      const feedbackId = deleteFeedback.feedback_id || deleteFeedback.id;
      await feedbacksAPI.delete(feedbackId);
      showToast(t('feedbacksGallery.feedbackDeletedSuccessfully'), 'success');
    } catch (error) {
      console.error('Failed to delete feedback:', error);
      showToast(formatErrorMessage('delete feedback', error), 'error');
    } finally {
      setDeleteFeedback(null);
    }
  };

  const handleDeleteAll = () => {
    setDeleteAll(true);
  };

  const handleConfirmDeleteAll = async () => {
    try {
      const response = await feedbacksAPI.deleteAll();
      const deletedCount = response?.deleted_ids?.length || 0;
      const feedbackText = deletedCount === 1 ? t('feedbacksGallery.feedbackSingular') : t('feedbacksGallery.feedbacksPlural');
      showToast(`${t('feedbacksGallery.successfullyDeleted')} ${deletedCount} ${feedbackText}`, 'success');
    } catch (error) {
      console.error('Failed to delete feedbacks:', error);
      showToast(formatErrorMessage('delete feedbacks', error), 'error');
    } finally {
      setDeleteAll(false);
    }
  };

  // Filtering
  const filteredFeedbacks = useMemo(() => {
    if (filterStatus === 'all') return currentFeedbacks;
    if (filterStatus === 'open') return currentFeedbacks.filter(f => !f.is_closed);
    if (filterStatus === 'closed') return currentFeedbacks.filter(f => f.is_closed);
    if (filterStatus === 'solved') return currentFeedbacks.filter(f => f.is_closed && f.solved);
    return currentFeedbacks;
  }, [currentFeedbacks, filterStatus]);

  // Sorting
  const sortedFeedbacks = useMemo(() => {
    if (!isAuthenticated) return filteredFeedbacks;

    const toValue = (item, field) => {
      switch (field) {
        case 'created_at':
          return item.created_at ? new Date(item.created_at).getTime() : 0;
        case 'sender_name':
          return (item.sender_name || '').toString().toLowerCase();
        case 'status':
          return item.is_closed ? 'closed' : 'open';
        case 'type':
          return item.type || 0;
        default:
          return '';
      }
    };

    const copy = [...filteredFeedbacks];
    copy.sort((a, b) => {
      const aVal = toValue(a, sortBy);
      const bVal = toValue(b, sortBy);
      
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      
      const comparison = String(aVal).localeCompare(String(bVal));
      return sortDir === 'asc' ? comparison : -comparison;
    });

    return copy;
  }, [filteredFeedbacks, sortBy, sortDir, isAuthenticated]);

  const handleSort = (field) => {
    if (sortBy === field) {
      const newDir = sortDir === 'asc' ? 'desc' : 'asc';
      setSortDir(newDir);
      setPreference('FeedbacksGallery.sortDir', newDir);
    } else {
      setSortBy(field);
      setSortDir('desc');
      setPreference('FeedbacksGallery.sortBy', field);
      setPreference('FeedbacksGallery.sortDir', 'desc');
    }
  };


  const handleFilterChange = (status) => {
    setFilterStatus(status);
    setPreference('FeedbacksGallery.filterStatus', status);
  };

  // Stats
  const stats = useMemo(() => {
    if (!isAuthenticated) return { total: 0, open: 0, closed: 0, solved: 0 };
    return {
      total: currentFeedbacks.length,
      open: currentFeedbacks.filter(f => !f.is_closed).length,
      closed: currentFeedbacks.filter(f => f.is_closed).length,
      solved: currentFeedbacks.filter(f => f.is_closed && f.solved).length
    };
  }, [currentFeedbacks, isAuthenticated]);

  return (
    <div className="min-h-screen bg-gray-50 overflow-x-hidden" dir={isRTL ? 'rtl' : 'ltr'}>
      <TopNavigationBar variant="light" showBackground={true} mode="full" />
      <div className="h-[4rem]"></div>
      <div className="sticky top-[4rem] z-30 bg-white border-b border-gray-200 shadow-sm">
        <div className="w-full px-4 sm:px-8 py-2 sm:py-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 mb-3 sm:mb-4">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-shrink-0">
              <Link
                to="/dashboard"
                className="p-1.5 sm:p-2 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
                title={t('feedbacksGallery.backToDashboard')}
                aria-label={t('feedbacksGallery.backToDashboard')}
              >
                {isRTL ? (
                  <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 text-gray-600" />
                ) : (
                  <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5 text-gray-600" />
                )}
              </Link>
              <div className="w-8 h-8 sm:w-12 sm:h-12 bg-primary-100 rounded-lg sm:rounded-xl flex items-center justify-center flex-shrink-0">
                <MessageSquare className="w-4 h-4 sm:w-6 sm:h-6 text-primary-600" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg sm:text-2xl font-bold text-gray-900 truncate">{t('feedbacksGallery.feedbacks')}</h1>
                <p className="text-xs sm:text-sm text-gray-500 truncate">
                  {isAuthenticated ? `${stats.total} ${t('feedbacksGallery.total')}, ${stats.open} ${t('feedbacksGallery.open')}` : t('feedbacksGallery.loading')}
                </p>
              </div>
            </div>

            {/* Delete All Button - Desktop */}
            {isAuthenticated && sortedFeedbacks.length > 0 && (
              <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={handleDeleteAll}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
                  title={t('feedbacksGallery.deleteAllTooltip')}
                  aria-label={t('feedbacksGallery.deleteAllTooltip')}
                >
                  <Trash className="w-4 h-4" />
                  <span>{t('feedbacksGallery.deleteAll')}</span>
                </button>
              </div>
            )}
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-0">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => handleFilterChange('all')}
                className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
                  filterStatus === 'all'
                    ? 'bg-primary-100 text-primary-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {t('feedbacksGallery.all')} ({stats.total})
              </button>
              <button
                onClick={() => handleFilterChange('open')}
                className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
                  filterStatus === 'open'
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {t('feedbacksGallery.open')} ({stats.open})
              </button>
              <button
                onClick={() => handleFilterChange('closed')}
                className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
                  filterStatus === 'closed'
                    ? 'bg-gray-200 text-gray-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {t('feedbacksGallery.closed')} ({stats.closed})
              </button>
              <button
                onClick={() => handleFilterChange('solved')}
                className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
                  filterStatus === 'solved'
                    ? 'bg-green-100 text-green-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {t('feedbacksGallery.solved')} ({stats.solved})
              </button>
            </div>

            {/* Delete All Button - Mobile */}
            {isAuthenticated && sortedFeedbacks.length > 0 && (
              <div className="flex sm:hidden items-center gap-2 flex-shrink-0">
                <button
                  onClick={handleDeleteAll}
                  className="flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-medium transition-colors"
                  title={t('feedbacksGallery.deleteAllTooltip')}
                  aria-label={t('feedbacksGallery.deleteAllTooltip')}
                >
                  <Trash className="w-3 h-3" />
                  <span>{t('feedbacksGallery.deleteAll')}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="w-full px-4 sm:px-8 py-3 sm:py-6 overflow-x-auto">
        <ScrollableTable
          style={{ maxHeight: 'calc(100vh - 20rem)' }}
          onRowClick={handleViewFeedback}
          columns={[
            {
              key: 'feedback_id',
              label: t('feedbacksGallery.id'),
              align: 'left',
              cellClassName: 'text-xs text-gray-500 font-mono',
              renderCell: (feedback) => feedback.feedback_id || feedback.id || 'N/A',
            },
            {
              key: 'sender_name',
              label: t('feedbacksGallery.senderName'),
              sortable: true,
              align: 'left',
              renderCell: (feedback) => feedback.sender_name,
            },
            {
              key: 'created_at',
              label: t('feedbacksGallery.date'),
              sortable: true,
              align: 'left',
              cellClassName: 'text-gray-600',
              renderCell: (feedback) => formatDateTimeLocale(feedback.created_at),
            },
            {
              key: 'type',
              label: t('feedbacksGallery.type'),
              sortable: true,
              align: 'left',
              renderCell: (feedback) => (
                <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                  feedback.type === 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                }`}>
                  {feedback.type === 0 ? t('feedbacksGallery.bug') : t('feedbacksGallery.idea')}
                </span>
              ),
            },
            {
              key: 'title',
              label: t('feedbacksGallery.title'),
              align: 'left',
              cellClassName: 'text-gray-900 max-w-xs truncate',
              renderCell: (feedback) => feedback.title,
            },
            {
              key: 'status',
              label: t('feedbacksGallery.status'),
              sortable: true,
              align: 'left',
              renderCell: (feedback) => {
                const isClosed = Boolean(feedback.is_closed);
                const isSolved = Boolean(feedback.solved);
                return (
                  <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                    isSolved
                      ? 'bg-green-100 text-green-700'
                      : isClosed
                      ? 'bg-gray-100 text-gray-700'
                      : 'bg-blue-100 text-blue-700'
                  }`}>
                    {isSolved ? (
                      <>
                        <CheckCircle className="w-4 h-4 align-text-bottom text-green-600" />
                        {t('feedbacksGallery.solved')}
                      </>
                    ) : isClosed ? (
                      <>
                        <XCircle className="w-4 h-4 align-text-bottom text-gray-600" />
                        {t('feedbacksGallery.closed')}
                      </>
                    ) : (
                      <>
                        <Clock className="w-4 h-4 align-text-bottom text-blue-600" />
                        {t('feedbacksGallery.open')}
                      </>
                    )}
                  </span>
                );
              },
            },
            {
              key: 'actions',
              label: t('feedbacksGallery.actions'),
              align: 'right',
              renderCell: (feedback, index) => (
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteFeedback(feedback);
                    }}
                    className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                    title={t('feedbacksGallery.delete')}
                    aria-label={t('feedbacksGallery.delete')}
                  >
                    <Trash2 className="w-4 h-4 text-red-600" />
                  </button>
                </div>
              ),
            },
          ]}
          data={sortedFeedbacks}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={handleSort}
          emptyState={{
            icon: MessageSquare,
            title: t('feedbacksGallery.noFeedbacksFound'),
            message: t('feedbacksGallery.noFeedbacksMatchFilter'),
          }}
          getRowKey={(feedback) => feedback.feedback_id || feedback.id}
        />
      </div>

      {/* Detail Modal */}
      {viewerOpen && sortedFeedbacks.length > 0 && (
        <FeedbackDetailModal
          {...viewerProps}
          feedbackId={sortedFeedbacks[viewerProps.currentIndex]?.feedback_id || sortedFeedbacks[viewerProps.currentIndex]?.id}
          totalFeedbacks={sortedFeedbacks.length}
          filteredFeedbacks={sortedFeedbacks}
        />
      )}

      {/* Delete Confirmation */}
      {deleteFeedback && (
        <ConfirmDelete
          isOpen={!!deleteFeedback}
          onClose={() => setDeleteFeedback(null)}
          onConfirm={handleConfirmDelete}
          title={t('account.deleteFeedbackTitle')}
          message={t('account.deleteFeedbackMessage')}
          itemName={deleteFeedback.sender_name}
          confirmText={t('account.delete')}
          cancelText={t('account.cancel')}
          caption={t('account.thisActionCannotBeUndone')}
        />
      )}

      {/* Delete All Confirmation */}
      {deleteAll && (
        <ConfirmDelete
          isOpen={deleteAll}
          onClose={() => setDeleteAll(false)}
          onConfirm={handleConfirmDeleteAll}
          title={t('feedbacksGallery.deleteAllTitle')}
          message={`${t('feedbacksGallery.deleteAllMessage')} ${sortedFeedbacks.length} ${sortedFeedbacks.length === 1 ? t('feedbacksGallery.feedbackSingular') : t('feedbacksGallery.feedbacksPlural')}?`}
          simpleMessage={true}
          confirmText={t('feedbacksGallery.deleteAll')}
          cancelText={t('account.cancel')}
          caption={t('feedbacksGallery.deleteAllCaption')}
        />
      )}

      {/* Login Modal */}
      <LoginModal
        isOpen={showLoginModal}
        onClose={closeLoginModal}
        onLogin={login}
        error={loginError}
      />
    </div>
  );
}


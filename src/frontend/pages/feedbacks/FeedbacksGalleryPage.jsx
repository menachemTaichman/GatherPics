import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { MessageSquare, Eye, Trash2, CheckCircle, XCircle, Clock, Trash } from 'lucide-react';
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

export default function FeedbacksGalleryPage() {
  const { isAuthenticated, isLoading, showLoginModal, loginError, login, closeLoginModal, openLoginModal } = useAuth();
  const [deleteFeedback, setDeleteFeedback] = useState(null);
  const [deleteAll, setDeleteAll] = useState(false);
  const [sortBy, setSortBy] = useState(() => getPreference('FeedbacksGallery.sortBy', 'created_at'));
  const [sortDir, setSortDir] = useState(() => getPreference('FeedbacksGallery.sortDir', 'desc'));
  const [filterStatus, setFilterStatus] = useState(() => getPreference('FeedbacksGallery.filterStatus', 'all'));
  
  const { showToast } = useToast();

  // Set document title
  useEffect(() => {
    document.title = `Feedbacks | ${APP_CONFIG.name}`;
  }, []);

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
    openViewer({
      index,
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
      showToast('Feedback deleted successfully', 'success');
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
      showToast(`Successfully deleted ${deletedCount} feedback${deletedCount !== 1 ? 's' : ''}`, 'success');
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
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <TopNavigationBar variant="light" showBackground={true} mode="full" />
      {/* Page Header */}
      <div className="bg-white border-b border-gray-200 pt-[4rem] flex-none z-30">
        <div className="w-full px-8 py-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center">
                <MessageSquare className="w-6 h-6 text-primary-600" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Feedbacks</h1>
                <p className="text-sm text-gray-500">
                  {isAuthenticated ? `${stats.total} total, ${stats.open} open` : 'Loading...'}
                </p>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <button
                onClick={() => handleFilterChange('all')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filterStatus === 'all'
                    ? 'bg-primary-100 text-primary-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                All ({stats.total})
              </button>
              <button
                onClick={() => handleFilterChange('open')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filterStatus === 'open'
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Open ({stats.open})
              </button>
              <button
                onClick={() => handleFilterChange('closed')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filterStatus === 'closed'
                    ? 'bg-gray-200 text-gray-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Closed ({stats.closed})
              </button>
              <button
                onClick={() => handleFilterChange('solved')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filterStatus === 'solved'
                    ? 'bg-green-100 text-green-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Solved ({stats.solved})
              </button>
            </div>

            {/* Delete All Button */}
            {isAuthenticated && sortedFeedbacks.length > 0 && (
              <button
                onClick={handleDeleteAll}
                className="flex items-center space-x-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
                title="Delete all feedbacks"
              >
                <Trash className="w-4 h-4" />
                <span>Delete All</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 w-full px-8 pt-6 pb-8">
        <ScrollableTable
          style={{ maxHeight: 'calc(100vh - 22rem)' }}
          columns={[
            {
              key: 'feedback_id',
              label: 'ID',
              align: 'left',
              cellClassName: 'text-xs text-gray-500 font-mono',
              renderCell: (feedback) => feedback.feedback_id || feedback.id || 'N/A',
            },
            {
              key: 'sender_name',
              label: 'Sender',
              sortable: true,
              align: 'left',
              renderCell: (feedback) => feedback.sender_name,
            },
            {
              key: 'created_at',
              label: 'Date',
              sortable: true,
              align: 'left',
              cellClassName: 'text-gray-600',
              renderCell: (feedback) => formatDateTimeLocale(feedback.created_at),
            },
            {
              key: 'type',
              label: 'Type',
              sortable: true,
              align: 'left',
              renderCell: (feedback) => (
                <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                  feedback.type === 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                }`}>
                  {feedback.type === 0 ? 'Bug' : 'Idea'}
                </span>
              ),
            },
            {
              key: 'title',
              label: 'Title',
              align: 'left',
              cellClassName: 'text-gray-900 max-w-xs truncate',
              renderCell: (feedback) => feedback.title,
            },
            {
              key: 'status',
              label: 'Status',
              sortable: true,
              align: 'left',
              renderCell: (feedback) => {
                const isClosed = Boolean(feedback.is_closed);
                const isSolved = Boolean(feedback.solved);
                return (
                  <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                    isSolved
                      ? 'bg-green-100 text-green-700'
                      : isClosed
                      ? 'bg-gray-100 text-gray-700'
                      : 'bg-blue-100 text-blue-700'
                  }`}>
                    {isSolved ? (
                      <>
                        <CheckCircle className="inline mr-1 w-4 h-4 align-text-bottom text-green-600" />
                        Solved
                      </>
                    ) : isClosed ? (
                      <>
                        <XCircle className="inline mr-1 w-4 h-4 align-text-bottom text-gray-600" />
                        Closed
                      </>
                    ) : (
                      <>
                        <Clock className="inline mr-1 w-4 h-4 align-text-bottom text-blue-600" />
                        Open
                      </>
                    )}
                  </span>
                );
              },
            },
            {
              key: 'actions',
              label: 'Actions',
              align: 'right',
              renderCell: (feedback, index) => (
                <div className="flex items-center justify-end space-x-2">
                  <button
                    onClick={() => handleViewFeedback(feedback, index)}
                    className="p-2 hover:bg-blue-100 rounded-lg transition-colors"
                    title="View details"
                  >
                    <Eye className="w-4 h-4 text-blue-600" />
                  </button>
                  <button
                    onClick={() => handleDeleteFeedback(feedback)}
                    className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                    title="Delete"
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
            title: 'No feedbacks found',
            message: 'No feedback submissions match your current filter.',
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
          title="Delete Feedback"
          message="Are you sure you want to delete this feedback"
          itemName={deleteFeedback.sender_name}
          confirmText="Delete"
          cancelText="Cancel"
          caption="This action cannot be undone."
        />
      )}

      {/* Delete All Confirmation */}
      {deleteAll && (
        <ConfirmDelete
          isOpen={deleteAll}
          onClose={() => setDeleteAll(false)}
          onConfirm={handleConfirmDeleteAll}
          title="Delete All Feedbacks"
          message={`Are you sure you want to delete all ${sortedFeedbacks.length} feedback${sortedFeedbacks.length !== 1 ? 's' : ''}?`}
          simpleMessage={true}
          confirmText="Delete All"
          cancelText="Cancel"
          caption="This action cannot be undone. All displayed feedbacks will be permanently deleted."
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


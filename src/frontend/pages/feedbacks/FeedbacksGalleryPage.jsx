import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { MessageSquare, Eye, Trash2, CheckCircle, XCircle, Clock, ArrowUp, ArrowDown } from 'lucide-react';
import { feedbacksAPI } from '../../utils/apiService';
import { useToast } from '../../contexts/ToastContext';
import { useFeedbacksList } from '../../utils/dataManager';
import { useApplyScopes } from '../../utils/storeUtils';
import { getPreference, setPreference } from '../../utils/settings';
import { formatErrorMessage } from '../../utils/errorHandler';
import { ConfirmDelete } from '../../components/modals';
import { FeedbackDetailModal } from '../../components/feedbacks';
import { useAuth } from '../../contexts/authContext';
import { useAuthRefresh } from '../../hooks/useAuthRefresh';

function formatDateTime(dateString) {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch {
    return dateString;
  }
}

export default function FeedbacksGalleryPage({ eventUrl }) {
  const { isAuthenticated } = useAuth();
  const [deleteFeedback, setDeleteFeedback] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedFeedbackId, setSelectedFeedbackId] = useState(null);
  const [sortBy, setSortBy] = useState(() => getPreference('FeedbacksGallery.sortBy', 'created_at'));
  const [sortDir, setSortDir] = useState(() => getPreference('FeedbacksGallery.sortDir', 'desc'));
  const [filterStatus, setFilterStatus] = useState(() => getPreference('FeedbacksGallery.filterStatus', 'all'));
  
  const { showToast } = useToast();

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

  const handleViewFeedback = (feedback) => {
    const feedbackId = feedback.feedback_id || feedback.id;
    setSelectedFeedbackId(feedbackId);
    setShowDetailModal(true);
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

  const handleCloseDetailModal = () => {
    setShowDetailModal(false);
    setSelectedFeedbackId(null);
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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
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
        </div>
      </div>

      {/* Content */}
      <div className="w-full px-8 py-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Table Header */}
          <div className="bg-gray-50 border-b border-gray-200 px-6 py-3 grid grid-cols-12 gap-4 text-sm font-medium text-gray-700">
            <button
              onClick={() => handleSort('sender_name')}
              className="col-span-2 flex items-center space-x-1 hover:text-primary-600 transition-colors text-left"
            >
              <span>Sender</span>
              {sortBy === 'sender_name' && (
                sortDir === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
              )}
            </button>
            <div className="col-span-1">Type</div>
            <div className="col-span-4">Title</div>
            <button
              onClick={() => handleSort('created_at')}
              className="col-span-2 flex items-center space-x-1 hover:text-primary-600 transition-colors text-left"
            >
              <span>Date</span>
              {sortBy === 'created_at' && (
                sortDir === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={() => handleSort('status')}
              className="col-span-2 flex items-center space-x-1 hover:text-primary-600 transition-colors text-left"
            >
              <span>Status</span>
              {sortBy === 'status' && (
                sortDir === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
              )}
            </button>
            <div className="col-span-1 text-right">Actions</div>
          </div>

          {/* Table Body */}
          <div className="divide-y divide-gray-100">
            {sortedFeedbacks.length === 0 ? (
              <div className="px-6 py-12 text-center text-gray-500">
                <MessageSquare className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p>No feedbacks found</p>
              </div>
            ) : (
              sortedFeedbacks.map((feedback, index) => {
                const feedbackId = feedback.feedback_id || feedback.id;
                const isClosed = feedback.is_closed === 1;
                const isSolved = feedback.solved === 1;

                return (
                  <motion.div
                    key={feedbackId}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.05 }}
                    className={`px-6 py-4 grid grid-cols-12 gap-4 items-center hover:bg-gray-50 transition-colors ${
                      feedback.isPlaceholder ? 'animate-pulse' : ''
                    }`}
                  >
                    {/* Sender */}
                    <div className="col-span-2">
                      {feedback.isPlaceholder ? (
                        <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                      ) : (
                        <div>
                          <p className="font-medium text-gray-900 truncate">{feedback.sender_name}</p>
                          {feedback.sender_email && (
                            <p className="text-xs text-gray-500 truncate">{feedback.sender_email}</p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Type */}
                    <div className="col-span-1">
                      {feedback.isPlaceholder ? (
                        <div className="h-6 bg-gray-200 rounded w-16"></div>
                      ) : (
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                          feedback.type === 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                        }`}>
                          {feedback.type === 0 ? 'Bug' : 'Idea'}
                        </span>
                      )}
                    </div>

                    {/* Title */}
                    <div className="col-span-4">
                      {feedback.isPlaceholder ? (
                        <div className="space-y-1">
                          <div className="h-3 bg-gray-200 rounded w-full"></div>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-900 font-medium line-clamp-1">{feedback.title}</p>
                      )}
                    </div>

                    {/* Date */}
                    <div className="col-span-2 text-sm text-gray-600">
                      {feedback.isPlaceholder ? (
                        <div className="h-3 bg-gray-200 rounded w-full"></div>
                      ) : (
                        formatDateTime(feedback.created_at)
                      )}
                    </div>

                    {/* Status */}
                    <div className="col-span-2">
                      {feedback.isPlaceholder ? (
                        <div className="h-6 bg-gray-200 rounded w-16"></div>
                      ) : (
                        <span className={`inline-flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-medium ${
                          isSolved
                            ? 'bg-green-100 text-green-700'
                            : isClosed
                            ? 'bg-gray-100 text-gray-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}>
                          {isSolved ? (
                            <>
                              <CheckCircle className="w-3 h-3" />
                              <span>Solved</span>
                            </>
                          ) : isClosed ? (
                            <>
                              <XCircle className="w-3 h-3" />
                              <span>Closed</span>
                            </>
                          ) : (
                            <>
                              <Clock className="w-3 h-3" />
                              <span>Open</span>
                            </>
                          )}
                        </span>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="col-span-1 flex items-center justify-end space-x-2">
                      {!feedback.isPlaceholder && (
                        <>
                          <button
                            onClick={() => handleViewFeedback(feedback)}
                            className="p-1.5 hover:bg-blue-100 rounded-lg transition-colors group"
                            title="View details"
                          >
                            <Eye className="w-4 h-4 text-blue-600" />
                          </button>
                          <button
                            onClick={() => handleDeleteFeedback(feedback)}
                            className="p-1.5 hover:bg-red-100 rounded-lg transition-colors group"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4 text-red-600" />
                          </button>
                        </>
                      )}
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Detail Modal */}
      {showDetailModal && selectedFeedbackId && (
        <FeedbackDetailModal
          isOpen={showDetailModal}
          onClose={handleCloseDetailModal}
          feedbackId={selectedFeedbackId}
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
    </div>
  );
}


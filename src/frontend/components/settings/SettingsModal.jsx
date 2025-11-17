import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Save, Settings as SettingsIcon, AlertCircle, HardDrive } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { settingsAPI } from '../../utils/apiService';
import { formatErrorMessage } from '../../utils/errorHandler';
import { useModalManager } from '../../utils/modalManager';
import { useModalFocus } from '../../hooks/useModalFocus';

export default function SettingsModal({ isOpen, onClose }) {
  const [isClient, setIsClient] = useState(false);
  const [settings, setSettings] = useState(null);
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { showToast } = useToast();
  const { registerModal, unregisterModal } = useModalManager();
  const modalIdRef = useRef('app-settings-modal');
  const enterSubmitRef = useRef(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;
    registerModal({
      id: modalIdRef.current,
      type: 'popup',
      allowOutsideScroll: true,
    });
    return () => unregisterModal(modalIdRef.current);
  }, [isOpen, registerModal, unregisterModal]);

  // Load settings when modal opens
  useEffect(() => {
    if (!isOpen) {
      setSettings(null);
      setSettingsDraft(null);
      setError('');
      return;
    }

    const loadSettings = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await settingsAPI.get();
        const loadedSettings = response.settings || {};
        setSettings(loadedSettings);
        setSettingsDraft({
          image_size_limit_bytes: loadedSettings.image_size_limit_bytes ?? 0,
          images_count_limit: loadedSettings.images_count_limit ?? 0,
          rekognition_calls_limit: loadedSettings.rekognition_calls_limit ?? 0,
          min_rank_to_create_event: loadedSettings.min_rank_to_create_event ?? 0,
        });
      } catch (err) {
        const errorMessage = formatErrorMessage(err, 'Failed to load settings');
        setError(errorMessage);
        showToast(errorMessage, 'error');
      } finally {
        setLoading(false);
      }
    };

    loadSettings();
  }, [isOpen, showToast]);


  const hasChanges = useCallback(() => {
    if (!settings || !settingsDraft) return false;
    return (
      settingsDraft.image_size_limit_bytes !== (settings.image_size_limit_bytes ?? 0) ||
      settingsDraft.images_count_limit !== (settings.images_count_limit ?? 0) ||
      settingsDraft.rekognition_calls_limit !== (settings.rekognition_calls_limit ?? 0) ||
      settingsDraft.min_rank_to_create_event !== (settings.min_rank_to_create_event ?? 0)
    );
  }, [settings, settingsDraft]);

  const canSave = !loading && !saving && settingsDraft && hasChanges();

  const handleFieldChange = useCallback((field, value) => {
    setSettingsDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, [field]: value };
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!canSave || !settingsDraft) return;

    setSaving(true);
    setError('');

    try {
      // Prepare update data (only include changed fields)
      const updateData = {};
      if (settingsDraft.image_size_limit_bytes !== (settings?.image_size_limit_bytes ?? 0)) {
        updateData.image_size_limit_bytes = settingsDraft.image_size_limit_bytes;
      }
      if (settingsDraft.images_count_limit !== (settings?.images_count_limit ?? 0)) {
        updateData.images_count_limit = settingsDraft.images_count_limit;
      }
      if (settingsDraft.rekognition_calls_limit !== (settings?.rekognition_calls_limit ?? 0)) {
        updateData.rekognition_calls_limit = settingsDraft.rekognition_calls_limit;
      }
      if (settingsDraft.min_rank_to_create_event !== (settings?.min_rank_to_create_event ?? 0)) {
        updateData.min_rank_to_create_event = settingsDraft.min_rank_to_create_event;
      }

      await settingsAPI.update(updateData);
      showToast('Settings saved successfully', 'success');
      onClose();
    } catch (err) {
      const errorMessage = formatErrorMessage(err, 'Failed to save settings');
      setError(errorMessage);
      showToast(errorMessage, 'error');
    } finally {
      setSaving(false);
    }
  }, [canSave, settingsDraft, settings, showToast, onClose]);

  const handleModalKeys = useCallback(
    (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return false;
      if (e.key !== 'Enter' || e.shiftKey) return false;

      const tagName = e.target.tagName?.toLowerCase();
      const inputType = e.target.type?.toLowerCase?.();
      const isInteractiveInput =
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select';

      if (!isInteractiveInput) {
        return false;
      }

      if (tagName === 'input' && (inputType === 'checkbox' || inputType === 'radio')) {
        return false;
      }

      if (!canSave) {
        e.preventDefault();
        enterSubmitRef.current = false;
        return true;
      }

      enterSubmitRef.current = true;
      return false;
    },
    [canSave]
  );

  const handleFormSubmit = useCallback(
    (e) => {
      e.preventDefault();
      if (saving) {
        enterSubmitRef.current = false;
        return;
      }
      if (!canSave) {
        enterSubmitRef.current = false;
        return;
      }
      const submitter = e.nativeEvent?.submitter;
      const source = enterSubmitRef.current
        ? 'enter-key'
        : submitter?.dataset?.submitSource || 'form-submit';
      enterSubmitRef.current = false;
      handleSave();
    },
    [canSave, saving, handleSave]
  );

  const { modalRef } = useModalFocus(isOpen, onClose, {
    modalId: modalIdRef.current,
    modalType: 'popup',
    allowOutsideScroll: true,
    customKeyHandler: handleModalKeys,
  });

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  if (!isClient) return null;

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={onClose}
        >
          <motion.form
            ref={modalRef}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3 }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-2xl"
            onSubmit={handleFormSubmit}
            noValidate
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <div className="flex items-center space-x-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-100 text-primary-600">
                  <SettingsIcon className="h-5 w-5" />
                </div>
                <div className="space-y-0.5">
                  <h2 className="text-xl font-semibold text-gray-900">App Settings</h2>
                  <p className="text-sm text-gray-500">Manage system-wide configuration</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                type="button"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 pt-6 pb-0">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="text-sm text-gray-500">Loading settings...</div>
                </div>
              ) : error && !settingsDraft ? (
                <div className="flex items-center gap-3 rounded-lg bg-red-50 p-4 text-red-800">
                  <AlertCircle className="h-5 w-5 flex-shrink-0" />
                  <div className="text-sm">{error}</div>
                </div>
              ) : settingsDraft ? (
                <div className="space-y-6 pb-6">
                  {error && (
                    <div className="flex items-center gap-3 rounded-lg bg-red-50 p-4 text-red-800">
                      <AlertCircle className="h-5 w-5 flex-shrink-0" />
                      <div className="text-sm">{error}</div>
                    </div>
                  )}

                  <div className="rounded-lg bg-gray-50 p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                      <HardDrive className="h-4 w-4" />
                      Limits
                    </h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">
                          Image Size Limit (bytes)
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={settingsDraft.image_size_limit_bytes ?? ''}
                          onChange={(e) => handleFieldChange('image_size_limit_bytes', e.target.value === '' ? 0 : parseInt(e.target.value, 10) || 0)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                          placeholder="0"
                        />
                        {settingsDraft.image_size_limit_bytes > 0 && (
                          <p className="mt-1 text-xs text-gray-500">
                            {formatBytes(settingsDraft.image_size_limit_bytes)}
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">
                          Images Count Limit
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={settingsDraft.images_count_limit ?? ''}
                          onChange={(e) => handleFieldChange('images_count_limit', e.target.value === '' ? 0 : parseInt(e.target.value, 10) || 0)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">
                          Rekognition Calls Limit
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={settingsDraft.rekognition_calls_limit ?? ''}
                          onChange={(e) => handleFieldChange('rekognition_calls_limit', e.target.value === '' ? 0 : parseInt(e.target.value, 10) || 0)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">
                          Minimum Rank to Create Event
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={settingsDraft.min_rank_to_create_event ?? ''}
                          onChange={(e) => handleFieldChange('min_rank_to_create_event', e.target.value === '' ? 0 : parseInt(e.target.value, 10) || 0)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
                          placeholder="0"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl flex justify-end space-x-3">
              <button
                onClick={onClose}
                disabled={saving}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                type="button"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSave}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                data-submit-source="save-button"
              >
                {saving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    <span>Save</span>
                  </>
                )}
              </button>
            </div>
          </motion.form>
        </div>
      )}
    </AnimatePresence>
  );

  return createPortal(modalContent, document.body);
}


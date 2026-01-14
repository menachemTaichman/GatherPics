import { useState, useMemo, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Search, Filter, User, Minus, Plus, ArrowUp, ArrowDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FaceCard } from '../../components/groups';
import SimpleVirtuosoGrid from '../../components/images/SimpleVirtuosoGrid';
import { useApplyScopes, useEventId } from '../../utils/storeUtils';
import { sortGroups, toggleSortOrder } from '../../utils/sorting';
import { usePreference } from '../../hooks/useSettings';
import { setPreference } from '../../utils/settings';
import { optimisticUpdates, handleAPIError, groupsAPI } from '../../utils/apiService';
import { useDataStore, selectors as storeSelectors, useGroupsList } from '../../utils/dataManager';
import { useAuth } from '../../contexts/authContext';
import { useAuthRefresh } from '../../hooks/useAuthRefresh';
import { ImageIconPlaceholder } from '../../hooks/useImage.jsx';
import { useRTL } from '../../hooks/useRTL';
import usePinchToZoom from '../../hooks/usePinchToZoom';
import i18n from '../../i18n';
import { APP_CONFIG } from '../../config/appConfig';

export default function Gallery({ eventUrl, groups, onUpdateGroup, onDeleteGroup, onRefreshGroups, urlHelpers: injectedUrlHelpers }) {
  const urlHelpers = injectedUrlHelpers;
  const eventId = useEventId(eventUrl);
  useApplyScopes([{ entity: 'all', id: 'groups', eventId }]);
  const { isAuthenticated } = useAuth();
  const { t } = useTranslation();
  const { isRTL, startClass, endClass, ps, pe } = useRTL();
  const [searchTerm, setSearchTerm] = useState('');
  const sortBy = usePreference('GroupsGallery.sortBy', 'name');
  const setSortBy = (value) => setPreference('GroupsGallery.sortBy', value);
  const sortOrder = usePreference('GroupsGallery.sortDir', 'desc');
  const setSortOrder = (value) => setPreference('GroupsGallery.sortDir', value);
  const cardSize = usePreference('general.size', 1.0);
  const setCardSize = (value) => setPreference('general.size', value);
  const [cardSizeInputValue, setCardSizeInputValue] = useState();
  
  // Mobile detection
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768; // md breakpoint
  });
  
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  
  // Pinch-to-zoom for mobile
  const setGridContainerRef = usePinchToZoom(cardSize, setCardSize);

  // Use the data store for groups
  const storeGroups = useGroupsList(eventId);
  
  // Create placeholder groups when not authenticated
  const placeholderGroups = useMemo(() => {
    return Array.from({ length: 36 }, (_, i) => ({
      id: `placeholder-${i}`,
      label: '',
      images: new Set(),
      isPlaceholder: true
    }));
  }, []);

  // Fetch groups data with auto-refresh on auth changes
  const loadGroups = useCallback(async () => {
    if (!eventUrl) return;
    try {
      await groupsAPI.getAll(eventUrl);
    } catch (e) {
      console.error('Failed to load groups', e);
    }
  }, [eventUrl]);
  
  useAuthRefresh(loadGroups, [eventUrl]);

  // Set document title
  useEffect(() => {
    document.title = `${t('groupsGallery.peopleGallery')} | ${APP_CONFIG.name}`;
  }, [i18n.language]);

  // Use groups from store or placeholders when not authenticated
  const currentGroups = isAuthenticated ? storeGroups : placeholderGroups;

  const filteredAndSortedGroups = useMemo(() => {
    // Skip filtering for placeholders
    if (!isAuthenticated) return currentGroups;
    
    let filtered = currentGroups.filter(group => {
      // Filter by search term
      const matchesSearch = group.label?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           String(group.id || '').includes(searchTerm);
      
      return matchesSearch;
    });

    // Sort groups using global utility
    return sortGroups(filtered, sortBy, sortOrder);
  }, [currentGroups, searchTerm, sortBy, sortOrder, isAuthenticated]);

  // Define renderItem separately to keep reference stable
  const renderFaceCard = useCallback((group, index) => {
    return (
      // No need for extra wrapper div here, the ItemContainer handles the sizing
      <FaceCard
        group={group}
        cardSize={cardSize}
        urlHelpers={urlHelpers}
        eventUrl={eventUrl}
        // PERFORMANCE TIP: Pass specific image props
        loading="eager" // Important! Let Virtuoso handle the loading/unloading
      />
    );
  }, [cardSize, urlHelpers, eventUrl]); // Dependencies

  return (
    <div className="w-full" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="h-[4rem]"></div>
      {/* Sticky Header */}
      <div className="sticky top-[4rem] z-30 bg-white border-b border-gray-200 px-4 sm:px-8 py-3 sm:py-4 shadow-sm">
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-1 sm:mb-2">
              {t('groupsGallery.peopleGallery')}
            </h1>
            <p className="text-sm sm:text-base text-gray-600">
              {filteredAndSortedGroups.length === currentGroups.length 
                ? `${filteredAndSortedGroups.length} ${t('groupsGallery.people')}`
                : `${filteredAndSortedGroups.length} ${t('groupsGallery.of')} ${currentGroups.length} ${t('groupsGallery.people')}`
              }
            </p>
          </div>
          
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="relative flex-1 sm:flex-initial">
              <Search className={`absolute ${startClass('3')} top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4`} />
              <input
                type="text"
                id="search-people"
                name="search-people"
                dir={isRTL ? 'rtl' : 'ltr'}
                placeholder={t('groupsGallery.searchPeople')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className={`${ps('10')} ${pe('4')} py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent w-full sm:w-64`}
              />
            </div>
            
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  dir={isRTL ? 'rtl' : 'ltr'}
                  className={`appearance-none ${ps('3')} ${pe('10')} py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white`}
                >
                  <option value="name">{t('groupsGallery.sortByName')}</option>
                  <option value="count">{t('groupsGallery.sortByCount')}</option>
                </select>
                <Filter className={`absolute ${endClass('3')} top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4 pointer-events-none`} />
              </div>
              
              <button
                onClick={() => setSortOrder(toggleSortOrder(sortOrder))}
                className="p-2 min-w-[2.5rem] min-h-[2.5rem] border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-center gap-1"
                title={`${t('groupsGallery.sort')} ${sortOrder === 'asc' ? t('groupsGallery.ascending') : t('groupsGallery.descending')}`}
                aria-label={`${t('groupsGallery.sort')} ${sortOrder === 'asc' ? t('groupsGallery.ascending') : t('groupsGallery.descending')}`}
              >
                {sortOrder === 'asc' ? (
                  <ArrowUp className="w-4 h-4" />
                ) : (
                  <ArrowDown className="w-4 h-4" />
                )}
              </button>

              {/* Size Control */}
              <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-2 sm:px-3 py-2">
                <button
                  onClick={() => {
                    const currentPercent = Math.round(cardSize * 100);
                    const next25 = Math.ceil(currentPercent / 25) * 25;
                    const prev25 = Math.floor((currentPercent - 1) / 25) * 25;
                    const subtract25 = currentPercent - 25;
                    const newPercent = Math.max(50, Math.max(subtract25, prev25));
                    setCardSize(newPercent / 100);
                  }}
                  disabled={cardSize <= 0.50}
                  className="p-1 min-w-[2rem] min-h-[2rem] hover:bg-gray-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                  title={t('groupsGallery.decreaseSize')}
                  aria-label={t('groupsGallery.decreaseSize')}
                >
                  <Minus className="w-4 h-4" />
                </button>
                <input
                  type="text"
                  id="card-size-input"
                  name="card-size-input"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  dir={isRTL ? 'rtl' : 'ltr'}
                  value={cardSizeInputValue !== undefined ? cardSizeInputValue : Math.round(cardSize * 100)}
                  onChange={e => setCardSizeInputValue(e.target.value.replace(/[^0-9]/g, ''))}
                  onBlur={e => {
                    let val = parseInt(e.target.value, 10);
                    if (isNaN(val)) val = Math.round(cardSize * 100);
                    val = Math.max(50, Math.min(175, val));
                    setCardSize(val / 100);
                    setCardSizeInputValue(undefined);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.target.blur();
                    } else if (e.key === 'Escape') {
                      setCardSizeInputValue(undefined);
                    }
                  }}
                  className="text-sm font-medium text-gray-700 text-center bg-transparent border-b border-gray-300 focus:outline-none focus:border-primary-500"
                  style={{width: '3rem'}}
                />
                <button
                  onClick={() => {
                    const currentPercent = Math.round(cardSize * 100);
                    const next25 = Math.ceil((currentPercent + 1) / 25) * 25;
                    const add25 = currentPercent + 25;
                    const newPercent = Math.min(175, Math.min(add25, next25));
                    setCardSize(newPercent / 100);
                  }}
                  disabled={cardSize >= 1.75}
                  className="p-1 min-w-[2rem] min-h-[2rem] hover:bg-gray-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                  title={t('groupsGallery.increaseSize')}
                  aria-label={t('groupsGallery.increaseSize')}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="px-4 sm:px-8 pt-0 pb-0">
        {/* Gallery Grid */}
      {filteredAndSortedGroups.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-12"
        >
          <User className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {searchTerm ? t('groupsGallery.noPeopleFound') : t('groupsGallery.noPeopleYet')}
          </h3>
          <p className="text-gray-500">
            {searchTerm 
              ? t('groupsGallery.tryAdjustingSearchTerms')
              : t('groupsGallery.uploadPhotosToGetStarted')
            }
          </p>
        </motion.div>
      ) : (
        <div className="w-full" style={{ height: `calc(100vh - ${isMobile ? '15rem' : '16rem'})`, marginTop: '1rem' }}>
          <SimpleVirtuosoGrid
            items={filteredAndSortedGroups}
            baseSize={Math.max(100, 175 * cardSize)}
            heightMultiplier={1.2}
            containerHeight="100%"
            className="w-full"
            onPinchRef={setGridContainerRef}
            // Overscan increased by default in component, but you can override:
            overscan={1500}
            renderItem={renderFaceCard} // Use the callback
          />
        </div>
      )}
      </div>
    </div>
  );
} 


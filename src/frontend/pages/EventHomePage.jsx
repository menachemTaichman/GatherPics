import { motion } from 'framer-motion';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, Calendar, Image as ImageIcon, Upload, Settings, FileText } from 'lucide-react';
import PermissionGate from '../components/common/PermissionGate.jsx';
import { EditEventModal } from '../components/events';
import { APP_CONFIG } from '../config/appConfig';
import { useToast } from '../contexts/ToastContext';
import { ImageComponent } from '../hooks/useImage.jsx';
import { API_BASE, eventsAPI } from '../utils/apiService';
import { useApplyScopes } from '../utils/storeUtils';
import { useEventGeneralById } from '../utils/dataManager';
import { usePermissions } from '../hooks/usePermissions';
import { useAuth } from '../contexts/authContext';

export default function EventHomePage({ eventUrl, eventData }) {
  const [showEventSettings, setShowEventSettings] = useState(false);
  const { showToast } = useToast();
  const { isAuthenticated } = useAuth();
  const [headerVisible, setHeaderVisible] = useState(false);
  const hideTimeoutRef = useRef(null);
  const headerOriginalStylesRef = useRef(null);
  const [isScrolled, setIsScrolled] = useState(false);
  const heroRef = useRef(null);
  const heroHeightRef = useRef(null);
  const heroInnerRef = useRef(null);
  const [naturalHeight, setNaturalHeight] = useState(null);

  const eventId = eventData?.id || eventData?.event_id || null;
  useApplyScopes(eventId ? [{ entity: 'event', id: String(eventId), eventId: 'general' }] : []);

  const storeEvent = useEventGeneralById(eventId);
  const resolvedEvent = storeEvent || eventData || null;

  // Fetch full event details when authenticated to ensure we have all fields (like name)
  useEffect(() => {
    if (!isAuthenticated || !eventUrl || !eventId) return;
    // Only fetch if store doesn't have the event yet (storeEvent is null/undefined)
    // This ensures we fetch full details once when authenticated
    if (storeEvent) return;
    
    eventsAPI.getById(eventUrl).catch(() => {
      // Silently fail - eventData prop should still work
    });
  }, [isAuthenticated, eventUrl, eventId, storeEvent]);

  const eventName = resolvedEvent?.name || 'Event';
  const permissions = usePermissions();
  const canSeeAlbums = Boolean(eventUrl) && (permissions.has_albums || permissions.hasArchiveAlbum || permissions.hasFavoritesAlbum || permissions.canEdit);

  // Track previous representative_image value to detect actual changes
  const prevRepresentativeImageRef = useRef(undefined);
  const [heroCacheBuster, setHeroCacheBuster] = useState(() => Date.now());

  useEffect(() => {
    // Only update cache buster when representative_image actually changes value
    // Skip update if this is the first time we're seeing a value (prevRef is undefined)
    // This prevents double image loads: one with initial cache buster, one after useEffect runs
    const currentImage = resolvedEvent?.representative_image ?? null;
    const prevImage = prevRepresentativeImageRef.current;
    
    // Only update if:
    // 1. We've seen a value before (prevImage !== undefined) AND it changed, OR
    // 2. We're transitioning from a value to null (or vice versa) after initial render
    if (prevImage !== undefined && prevImage !== currentImage) {
      setHeroCacheBuster(Date.now());
    }
    
    // Always update the ref to track the current value
    prevRepresentativeImageRef.current = currentImage;
  }, [resolvedEvent?.representative_image]);

  // Refresh cache buster on auth:login to reload image after sign in
  useEffect(() => {
    const handleAuthLogin = () => {
      // Refresh cache buster to force image reload after sign in
      setHeroCacheBuster(Date.now());
    };

    const handleAuthLogout = () => {
      // Clear cache buster on logout to ensure image is cleared
      setHeroCacheBuster(Date.now());
    };

    window.addEventListener('auth:login', handleAuthLogin);
    window.addEventListener('auth:logout', handleAuthLogout);

    return () => {
      window.removeEventListener('auth:login', handleAuthLogin);
      window.removeEventListener('auth:logout', handleAuthLogout);
    };
  }, []);

  const representativeCacheKey = useMemo(() => {
    const imageKey = resolvedEvent?.representative_image ? String(resolvedEvent.representative_image) : 'none';
    return `${imageKey}-${heroCacheBuster}`;
  }, [resolvedEvent?.representative_image, heroCacheBuster]);

  const heroImageUrl = useMemo(() => {
    // Don't show image if not authenticated or no event data
    if (!isAuthenticated || !eventId || !resolvedEvent) return null;
    return `${API_BASE}/api/events/${eventId}/representative/display?v=${encodeURIComponent(representativeCacheKey)}`;
  }, [isAuthenticated, eventId, resolvedEvent, representativeCacheKey]);

  const primaryDate = resolvedEvent?.date || resolvedEvent?.start || resolvedEvent?.start_date || null;
  const formattedDate = useMemo(() => {
    if (!primaryDate) return null;
    try {
      const parsed = new Date(primaryDate);
      if (Number.isNaN(parsed.getTime())) return null;
      return parsed.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return null;
    }
  }, [primaryDate]);

  const shortFormattedDate = useMemo(() => {
    if (!primaryDate) return null;
    try {
      const parsed = new Date(primaryDate);
      if (Number.isNaN(parsed.getTime())) return null;
      return parsed.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return null;
    }
  }, [primaryDate]);

  const applyHeaderVisibility = useCallback((visible) => {
    const headerEl = document.querySelector('[data-main-header]');
    if (!headerEl) return;
    if (!headerOriginalStylesRef.current) {
      headerOriginalStylesRef.current = {
        position: headerEl.style.position,
        width: headerEl.style.width,
        left: headerEl.style.left,
        right: headerEl.style.right,
        top: headerEl.style.top,
        opacity: headerEl.style.opacity,
        pointerEvents: headerEl.style.pointerEvents,
        transform: headerEl.style.transform,
        transition: headerEl.style.transition,
      };
    }
    headerEl.style.position = 'fixed';
    headerEl.style.left = '0';
    headerEl.style.right = '0';
    headerEl.style.top = '0';
    headerEl.style.width = '100%';
    headerEl.style.opacity = visible ? '1' : '0';
    headerEl.style.pointerEvents = visible ? 'auto' : 'none';
    headerEl.style.transform = visible ? 'translateY(0)' : 'translateY(-120%)';
    headerEl.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
  }, []);

  const clearHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current) {
      window.clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  const AUTO_HIDE_DELAY_MS = 500;

  const scheduleHide = useCallback(() => {
    clearHideTimeout();
    hideTimeoutRef.current = window.setTimeout(() => {
      hideTimeoutRef.current = null;
      setHeaderVisible(false);
    }, AUTO_HIDE_DELAY_MS);
  }, [AUTO_HIDE_DELAY_MS, clearHideTimeout]);

  const handleInteraction = useCallback(() => {
    setHeaderVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  const restoreHeaderStyles = useCallback(() => {
    const headerEl = document.querySelector('[data-main-header]');
    if (!headerEl || !headerOriginalStylesRef.current) return;
    const original = headerOriginalStylesRef.current;
    headerEl.style.position = original.position || '';
    headerEl.style.width = original.width || '';
    headerEl.style.left = original.left || '';
    headerEl.style.right = original.right || '';
    headerEl.style.top = original.top || '';
    headerEl.style.opacity = original.opacity || '';
    headerEl.style.pointerEvents = original.pointerEvents || '';
    headerEl.style.transform = original.transform || '';
    headerEl.style.transition = original.transition || '';
  }, []);

  useEffect(() => {
    applyHeaderVisibility(headerVisible);
  }, [applyHeaderVisibility, headerVisible]);

  useEffect(() => {
    applyHeaderVisibility(false);
    const events = ['pointermove', 'wheel', 'keydown', 'touchstart', 'scroll'];
    events.forEach((event) => window.addEventListener(event, handleInteraction, { passive: true }));
    return () => {
      events.forEach((event) => window.removeEventListener(event, handleInteraction));
      clearHideTimeout();
      applyHeaderVisibility(true);
      restoreHeaderStyles();
    };
  }, [applyHeaderVisibility, clearHideTimeout, handleInteraction, restoreHeaderStyles]);

  useEffect(() => {
    let ticking = false;
    let scrollTimeout = null;
    
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const scrollY = window.scrollY;
          // Use a lower threshold (50px) so it triggers even with minimal content
          // This ensures the animation works even when there's only one row of buttons
          const scrollDownThreshold = 50;
          const newIsScrolled = scrollY > scrollDownThreshold;
          
          // Clear any pending scroll timeout
          if (scrollTimeout) {
            clearTimeout(scrollTimeout);
          }
          
          // Small debounce to reduce rapid toggling during fast scrolling
          scrollTimeout = setTimeout(() => {
            if (newIsScrolled !== isScrolled) {
              setIsScrolled(newIsScrolled);
            }
          }, 10); // 10ms debounce for smoother feel
          
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (scrollTimeout) clearTimeout(scrollTimeout);
    };
  }, [isScrolled]);

  useEffect(() => {
    // Measure natural height on mount
    if (heroInnerRef.current && !naturalHeight) {
      const height = heroInnerRef.current.offsetHeight;
      setNaturalHeight(height);
    }
  }, [naturalHeight]);

  useEffect(() => {
    if (heroInnerRef.current && naturalHeight) {
      const innerEl = heroInnerRef.current;
      const targetHeight = isScrolled ? 150 : naturalHeight;
      
      // Ensure transition is set first - longer duration and smoother easing for less bounce
      const transitionValue = 'height 700ms cubic-bezier(0.25, 0.46, 0.45, 0.94), min-height 700ms cubic-bezier(0.25, 0.46, 0.45, 0.94), max-height 700ms cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      innerEl.style.transition = transitionValue;
      
      // Use double requestAnimationFrame to ensure browser has applied transition before changing height
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          innerEl.style.height = `${targetHeight}px`;
          innerEl.style.minHeight = `${targetHeight}px`;
          if (isScrolled) {
            innerEl.style.maxHeight = '150px';
          } else {
            innerEl.style.removeProperty('max-height');
          }
        });
      });
    }
  }, [isScrolled, naturalHeight]);

  // Define navigation cards
  const navCards = [
    {
      id: 'timeline',
      to: `/${eventUrl}/timeline`,
      icon: Calendar,
      title: 'Timeline',
      description: 'Browse photos by moment',
      iconBg: 'from-blue-100 to-blue-50',
      iconColor: 'text-blue-600',
      hoverBg: 'group-hover:from-blue-500 group-hover:to-blue-600',
      hoverIcon: 'group-hover:text-white',
      borderHover: 'hover:border-blue-200',
      show: Boolean(eventUrl) && permissions.has_images,
      requires: 'has_images'
    },
    {
      id: 'people',
      to: `/${eventUrl}/people`,
      icon: Users,
      title: 'People',
      description: 'View photos by person',
      iconBg: 'from-emerald-100 to-emerald-50',
      iconColor: 'text-emerald-600',
      hoverBg: 'group-hover:from-emerald-500 group-hover:to-emerald-600',
      hoverIcon: 'group-hover:text-white',
      borderHover: 'hover:border-emerald-200',
      show: Boolean(eventUrl) && permissions.has_groups,
      requires: 'has_groups'
    },
    {
      id: 'albums',
      to: `/${eventUrl}/albums`,
      icon: ImageIcon,
      title: 'Albums',
      description: 'Organized photo collections',
      iconBg: 'from-purple-100 to-purple-50',
      iconColor: 'text-purple-600',
      hoverBg: 'group-hover:from-purple-500 group-hover:to-purple-600',
      hoverIcon: 'group-hover:text-white',
      borderHover: 'hover:border-purple-200',
      show: Boolean(eventUrl) && canSeeAlbums,
      requires: ['has_albums', 'hasArchiveAlbum', 'hasFavoritesAlbum', 'canEdit'],
      requiresAll: false
    },
    {
      id: 'uploads',
      to: `/${eventUrl}/uploads`,
      icon: Upload,
      title: 'Uploads',
      description: 'Manage your contributions',
      iconBg: 'from-orange-100 to-orange-50',
      iconColor: 'text-orange-600',
      hoverBg: 'group-hover:from-orange-500 group-hover:to-orange-600',
      hoverIcon: 'group-hover:text-white',
      borderHover: 'hover:border-orange-200',
      show: Boolean(eventUrl) && permissions.canUploadAndDeleteImages,
      requires: 'canUploadAndDeleteImages'
    },
    {
      id: 'access-requests',
      to: `/${eventUrl}/requests`,
      icon: FileText,
      title: 'Access Requests',
      description: 'Review pending access requests',
      iconBg: 'from-sky-100 to-sky-50',
      iconColor: 'text-sky-700',
      hoverBg: 'group-hover:from-sky-500 group-hover:to-sky-600',
      hoverIcon: 'group-hover:text-white',
      borderHover: 'hover:border-sky-200',
      show: Boolean(eventUrl) && permissions.isProfilesManager,
      requires: 'isProfilesManager'
    },
    {
      id: 'profiles',
      to: `/${eventUrl}/profiles`,
      icon: Users,
      title: 'Profiles',
      description: 'Manage user profiles and permissions',
      iconBg: 'from-purple-100 to-purple-50',
      iconColor: 'text-purple-600',
      hoverBg: 'group-hover:from-purple-500 group-hover:to-purple-600',
      hoverIcon: 'group-hover:text-white',
      borderHover: 'hover:border-purple-200',
      show: Boolean(eventUrl) && permissions.isProfilesManager,
      requires: 'isProfilesManager'
    },
    {
      id: 'event-settings',
      icon: Settings,
      title: 'Event Settings',
      description: 'Update event details and limits',
      iconBg: 'from-slate-100 to-slate-50',
      iconColor: 'text-slate-600',
      hoverBg: 'group-hover:from-slate-500 group-hover:to-slate-600',
      hoverIcon: 'group-hover:text-white',
      borderHover: 'hover:border-slate-200',
      show: Boolean(eventUrl) && permissions.canManageEvent,
      requires: 'canManageEvent',
      isButton: true,
      onClick: () => setShowEventSettings(true)
    }
  ];

  const visibleCards = navCards.filter(card => card.show);
  const columnsPerRow = visibleCards.length >= 3 ? 3 : Math.max(visibleCards.length, 1);
  const remainder = columnsPerRow === 3 ? visibleCards.length % 3 : 0;
  const lastRowCount = remainder === 0 ? 0 : remainder;
  const lastRowStartIndex = lastRowCount > 0 ? visibleCards.length - lastRowCount : visibleCards.length;

  const renderCard = (card, index, wrapperClassName = '') => {
    const WrapperComponent = card.isButton ? 'button' : Link;
    const wrapperProps = card.isButton
      ? {
          type: 'button',
          onClick: card.onClick || (() => {}),
          className: 'block h-full w-full text-left group'
        }
      : {
          to: card.to,
          className: 'block h-full group'
        };

    const cardContent = (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 + index * 0.05 }}
        className={['h-full', wrapperClassName].filter(Boolean).join(' ')}
      >
        <WrapperComponent {...wrapperProps}>
          <motion.div 
            className={`h-full bg-white border border-gray-200 ${card.borderHover} hover:shadow-lg transition-all duration-300 p-6 relative overflow-hidden rounded-lg`}
            whileHover={{ y: -4 }}
          >
            <div className="flex flex-col items-center text-center relative z-10">
              <motion.div 
                className={`w-14 h-14 bg-gradient-to-br ${card.iconBg} ${card.hoverBg} rounded-xl flex items-center justify-center mb-4 transition-all duration-300 shadow-sm`}
                whileHover={{ scale: 1.05 }}
              >
                <card.icon className={`w-7 h-7 ${card.iconColor} ${card.hoverIcon} transition-colors duration-300`} />
              </motion.div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2 transition-colors">
                {card.title}
              </h3>
              <p className="text-sm text-gray-600 leading-relaxed">
                {card.description}
              </p>
            </div>
          </motion.div>
        </WrapperComponent>
      </motion.div>
    );

    if (card.requires) {
      return (
        <PermissionGate key={card.to} requires={card.requires} requiresAll={card.requiresAll ?? true}>
          {cardContent}
        </PermissionGate>
      );
    }

    return cardContent;
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="bg-gradient-to-b from-gray-50 to-white relative overflow-hidden"
      style={{ minHeight: 'calc(100vh - 4rem)' }}
    >
      {/* Subtle animated background accent */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute top-0 right-0 w-96 h-96 bg-primary-100/30 rounded-full blur-3xl"
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.3, 0.2, 0.3],
          }}
          transition={{
            duration: 8,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />
        <motion.div
          className="absolute bottom-0 left-0 w-96 h-96 bg-purple-100/20 rounded-full blur-3xl"
          animate={{
            scale: [1, 1.3, 1],
            opacity: [0.2, 0.3, 0.2],
          }}
          transition={{
            duration: 10,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />
      </div>

      <div
        className="container mx-auto px-4 pt-0 pb-20 relative z-10 mt-[-4.5rem]"
        style={{ minHeight: 'max(calc(100vh - 4rem - 10rem), 0px)' }}
      >
        {/* Header */}
        <div 
          ref={heroHeightRef}
          className="mb-16 relative min-h-[380px] sm:min-h-[460px] md:min-h-[560px]"
          style={{ 
            marginTop: '-4.5rem'
          }}
        >
          {/* Spacer to maintain space when hero shrinks */}
          {naturalHeight && (
            <div 
              style={{ 
                height: isScrolled ? `${naturalHeight - 150}px` : '0px',
                transition: 'height 700ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                overflow: 'hidden'
              }}
            />
          )}
          <motion.div
            ref={heroRef}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className={`transition-all duration-700 ease-out ${isScrolled ? 'fixed top-0 left-0 right-0 z-50' : 'relative'}`}
            style={isScrolled ? { 
              marginTop: 0,
              marginLeft: 0,
              marginRight: 0
            } : {}}
          >
            <div className={`relative ${isScrolled ? 'w-full' : '-mx-4 sm:-mx-8 md:-mx-12 lg:-mx-16 xl:-mx-24'}`}>
              <div 
                ref={heroInnerRef}
                className={`relative isolate overflow-hidden bg-gray-900 shadow-2xl w-full ${!naturalHeight ? 'min-h-[380px] sm:min-h-[460px] md:min-h-[560px]' : ''}`}
                style={{
                  transition: 'height 700ms cubic-bezier(0.25, 0.46, 0.45, 0.94), min-height 700ms cubic-bezier(0.25, 0.46, 0.45, 0.94), max-height 700ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                  willChange: 'height, min-height, max-height',
                  transform: 'translateZ(0)',
                  backfaceVisibility: 'hidden',
                  WebkitBackfaceVisibility: 'hidden'
                }}
              >
                <div className="absolute inset-0">
                  {ImageComponent(
                    heroImageUrl,
                    {
                      width: 1600,
                      height: 640,
                      className: 'h-full w-full object-cover',
                      alt: eventName ? `${eventName} highlight` : 'Event highlight',
                      loading: 'eager',
                    }
                  )}
                </div>
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-black/70 via-black/40 to-black/35" />
                {!isScrolled && (
                  <>
                    <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary-500/40 blur-3xl" />
                    <div className="pointer-events-none absolute -left-16 bottom-0 h-64 w-64 rounded-full bg-purple-500/30 blur-3xl" />
                  </>
                )}
                <div className={`relative z-10 flex h-full flex-col ${isScrolled ? 'justify-start px-4 sm:px-6 py-3 sm:py-4' : 'justify-start px-8 pb-8 pt-28 sm:px-10 sm:pb-10 sm:pt-36 md:px-12 md:pb-12 md:pt-40'} transition-all duration-500 ease-in-out`}>
                  {isScrolled ? (
                    <div className="flex flex-col gap-2.5 sm:gap-3">
                      <span className="inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] text-white/80 backdrop-blur whitespace-nowrap w-fit">
                        {APP_CONFIG.name}
                      </span>
                      <h1 className="text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight text-white">
                        {eventName}
                      </h1>
                      <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 text-xs font-medium text-white/80">
                        {formattedDate && (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/35 px-3 py-1 backdrop-blur whitespace-nowrap">
                            <Calendar className="h-4 w-4 shrink-0" />
                            <span className="hidden sm:inline">{formattedDate}</span>
                            {shortFormattedDate && <span className="sm:hidden">{shortFormattedDate}</span>}
                          </span>
                        )}
                        {resolvedEvent?.location && (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/35 px-3 py-1 backdrop-blur whitespace-nowrap">
                            {resolvedEvent.location}
                          </span>
                        )}
                        {resolvedEvent?.images_count ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/35 px-3 py-1 backdrop-blur whitespace-nowrap">
                            {resolvedEvent.images_count} photos
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <span className="inline-flex items-center rounded-full bg-white/15 px-4 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white/80 backdrop-blur">
                        {APP_CONFIG.name}
                      </span>
                      <h1 className="mt-5 text-4xl font-semibold tracking-tight text-white md:text-5xl">
                        {eventName}
                      </h1>
                      <div className="mt-6 flex flex-wrap gap-3 text-xs font-medium text-white/80 sm:text-sm">
                        {formattedDate && (
                          <span className="inline-flex items-center gap-2 rounded-full bg-black/35 px-3 py-1 backdrop-blur">
                            <Calendar className="h-4 w-4" />
                            {formattedDate}
                          </span>
                        )}
                        {resolvedEvent?.location && (
                          <span className="inline-flex items-center gap-2 rounded-full bg-black/35 px-3 py-1 backdrop-blur">
                            {resolvedEvent.location}
                          </span>
                        )}
                        {resolvedEvent?.images_count ? (
                          <span className="inline-flex items-center gap-2 rounded-full bg-black/35 px-3 py-1 backdrop-blur">
                            {resolvedEvent.images_count} photos
                          </span>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Navigation Cards */}
        <div className="max-w-5xl mx-auto">
          <div className={`grid grid-cols-1 ${columnsPerRow >= 3 ? 'md:grid-cols-3' : columnsPerRow === 2 ? 'md:grid-cols-2' : ''} gap-5`}>
            {visibleCards.map((card, index) => {
              const isInLastCustomRow = columnsPerRow === 3 && index >= lastRowStartIndex;
              if (columnsPerRow === 3 && isInLastCustomRow) {
                return null;
              }

              return (
                <Fragment key={card.id || card.to || card.title}>
                  {renderCard(card, index)}
                </Fragment>
              );
            })}

            {columnsPerRow === 3 && lastRowCount > 0 && (
              <div className="md:col-span-3">
                <div
                  className={`flex flex-col gap-5 ${lastRowCount > 1 ? 'md:flex-row md:justify-center' : 'md:items-center md:justify-center'} md:gap-6`}
                >
                  {visibleCards.slice(-lastRowCount).map((card, sliceIndex) => (
                    <Fragment key={card.id || card.to || card.title}>
                      {renderCard(
                        card,
                        visibleCards.length - lastRowCount + sliceIndex,
                        lastRowCount === 1
                          ? 'w-full md:max-w-xs'
                          : 'w-full md:max-w-xs md:flex-1'
                      )}
                    </Fragment>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="text-center mt-20 pb-8"
        >
          <div className="flex flex-wrap items-center justify-center gap-4 text-sm text-gray-600">
            <Link
              to="/about"
              className="hover:text-primary-600 transition-colors duration-200"
            >
              About
            </Link>
            <span className="text-gray-400">•</span>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('feedback:open-form'))}
              className="hover:text-primary-600 transition-colors duration-200"
            >
              Send Feedback
            </button>
          </div>
          <p className="text-gray-400 text-xs mt-4">
            {APP_CONFIG.name}
          </p>
        </motion.div>
      </div>

      <PermissionGate requires="canManageEvent">
        <EditEventModal
          eventUrl={eventUrl}
          isOpen={showEventSettings}
          onClose={() => setShowEventSettings(false)}
          onToast={showToast}
        />
      </PermissionGate>
    </motion.div>
  );
}


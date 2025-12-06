import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { MessageSquare, LayoutDashboard, Calendar, User, Settings } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { TopNavigationBar } from '../../components/layout';
import { useAuth } from '../../contexts/authContext';
import { LoginModal } from '../../components/auth';
import { APP_CONFIG } from '../../config/appConfig';
import { getCurrentProfile } from '../../utils/profileService';
import { usePermissions } from '../../hooks/usePermissions';
import { useRTL } from '../../hooks/useRTL';
import i18n from '../../i18n';
export default function DashboardPage() {
  const { isAuthenticated, isLoading, showLoginModal, loginError, login, closeLoginModal, openLoginModal } = useAuth();
  const { t } = useTranslation();
  const { isRTL, startClass, endClass } = useRTL();
  const currentProfile = getCurrentProfile();
  const permissions = usePermissions();
  const hasManageableEvents = Boolean(currentProfile?.has_manageable_events);
  const hasFeedbacks = Boolean(currentProfile?.has_feedbacks);
  const isProfilesManager = permissions.isProfilesManager;
  const hasSettings = permissions.has_settings;

  // Set document title
  useEffect(() => {
    document.title = `${t('dashboard.dashboard')} | ${APP_CONFIG.name}`;
  }, [i18n.language]);

  // Auto-show login modal when not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      openLoginModal();
    }
  }, [isAuthenticated, isLoading, openLoginModal]);

  const sections = [
    {
      id: 'events',
      title: t('dashboard.events'),
      description: t('dashboard.reviewAndConfigureEventSettings'),
      icon: Calendar,
      link: '/dashboard/events',
      iconBg: 'from-blue-100 to-blue-50',
      iconColor: 'text-blue-600',
      hoverBg: 'group-hover:from-blue-500 group-hover:to-blue-600',
      hoverIcon: 'group-hover:text-white',
      borderHover: 'hover:border-blue-200',
      show: hasManageableEvents
    },
    {
      id: 'profiles',
      title: t('dashboard.profiles'),
      description: t('dashboard.manageUserProfilesAndPermissions'),
      icon: User,
      link: '/dashboard/profiles',
      iconBg: 'from-purple-100 to-purple-50',
      iconColor: 'text-purple-600',
      hoverBg: 'group-hover:from-purple-500 group-hover:to-purple-600',
      hoverIcon: 'group-hover:text-white',
      borderHover: 'hover:border-purple-200',
      show: isProfilesManager
    },
    {
      id: 'feedbacks',
      title: t('dashboard.feedbacks'),
      description: t('dashboard.viewAndManageUserFeedback'),
      icon: MessageSquare,
      link: '/dashboard/feedbacks',
      iconBg: 'from-primary-100 to-primary-50',
      iconColor: 'text-primary-600',
      hoverBg: 'group-hover:from-primary-500 group-hover:to-primary-600',
      hoverIcon: 'group-hover:text-white',
      borderHover: 'hover:border-primary-200',
      show: hasFeedbacks
    },
    {
      id: 'settings',
      title: t('dashboard.appSettings'),
      description: t('dashboard.manageSystemWideConfiguration'),
      icon: Settings,
      link: '/dashboard/settings',
      iconBg: 'from-gray-100 to-gray-50',
      iconColor: 'text-gray-600',
      hoverBg: 'group-hover:from-gray-500 group-hover:to-gray-600',
      hoverIcon: 'group-hover:text-white',
      borderHover: 'hover:border-gray-200',
      show: hasSettings
    }
  ];

  const visibleSections = sections.filter(section => section.show !== false);
  const columnsPerRow = 3;
  const remainder = visibleSections.length % columnsPerRow;
  const fullRowsCount = visibleSections.length - remainder;
  const lastRowCount = remainder === 0 ? (visibleSections.length > 0 && visibleSections.length < columnsPerRow ? visibleSections.length : 0) : remainder;
  const mainSections = visibleSections.slice(0, fullRowsCount);
  const trailingSections = visibleSections.slice(fullRowsCount);

  const renderCard = (section, index, wrapperClassName = '') => {
    const Icon = section.icon;
    const CardWrapper = section.onClick ? 'div' : Link;
    const cardProps = section.onClick
      ? {
          onClick: section.onClick,
          className: `block h-full group cursor-pointer ${!isAuthenticated ? 'pointer-events-none' : ''}`,
          tabIndex: isAuthenticated ? 0 : -1,
          role: 'button',
          'aria-disabled': !isAuthenticated,
        }
      : {
          to: section.link,
          className: `block h-full group ${!isAuthenticated ? 'pointer-events-none' : ''}`,
          tabIndex: isAuthenticated ? 0 : -1,
          'aria-disabled': !isAuthenticated,
        };

    return (
      <motion.div
        key={section.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 + index * 0.05 }}
        className={['h-full', wrapperClassName].filter(Boolean).join(' ')}
      >
        <CardWrapper {...cardProps}>
          <motion.div
            className={`relative h-full overflow-hidden rounded-lg border border-gray-200 bg-white p-6 transition-all duration-300 hover:shadow-lg ${section.borderHover} ${
              !isAuthenticated ? 'opacity-60' : ''
            }`}
            whileHover={{ y: isAuthenticated ? -4 : 0 }}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white via-white to-white opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
            <div className="flex h-full flex-col items-center text-center relative z-10">
              <motion.div
                className={`mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br ${section.iconBg} ${section.hoverBg} shadow-sm transition-all duration-300`}
                whileHover={{ scale: isAuthenticated ? 1.05 : 1 }}
              >
                <Icon className={`h-7 w-7 ${section.iconColor} ${section.hoverIcon} transition-colors duration-300`} />
              </motion.div>
              <h3 className="mb-2 text-xl font-semibold text-gray-900 transition-colors group-hover:text-primary-600">
                {section.title}
              </h3>
              <p className="text-sm leading-relaxed text-gray-600">{section.description}</p>
              {!isAuthenticated && !isLoading && (
                <span className="mt-4 rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-600">
                  {t('dashboard.signInToAccess')}
                </span>
              )}
            </div>
          </motion.div>
        </CardWrapper>
      </motion.div>
    );
  };

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className="min-h-screen bg-gradient-to-b from-gray-50 via-white to-gray-100">
      <TopNavigationBar variant="light" showBackground={true} mode="full" />
      <div className="pt-[4rem]">
      <div className="relative">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <motion.div
            className={`absolute top-0 ${endClass('0')} h-96 w-96 rounded-full bg-primary-100/30 blur-3xl`}
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.3, 0.2, 0.3]
            }}
            transition={{
              duration: 8,
              repeat: Infinity,
              ease: 'easeInOut'
            }}
          />
          <motion.div
            className={`absolute bottom-0 ${startClass('0')} h-96 w-96 rounded-full bg-purple-100/20 blur-3xl`}
            animate={{
              scale: [1, 1.3, 1],
              opacity: [0.2, 0.3, 0.2]
            }}
            transition={{
              duration: 10,
              repeat: Infinity,
              ease: 'easeInOut'
            }}
          />
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="relative z-10"
        >
          <div
            className="container mx-auto px-4 py-20"
            style={{ minHeight: 'max(calc(100vh - 4rem - 10rem), 0px)' }}
          >
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="mx-auto mb-12 max-w-4xl text-center"
            >
              <div className="mb-5 flex items-center justify-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-600/10">
                  <LayoutDashboard className="h-8 w-8 text-primary-600" />
                </div>
                <div className={isRTL ? 'text-right' : 'text-left'}>
                  <h1 className="text-4xl font-semibold tracking-tight text-gray-900 md:text-5xl">{t('dashboard.dashboard')}</h1>
                  <p className="text-base text-gray-500 md:text-lg">{t('dashboard.systemManagementAndAdministration')}</p>
                </div>
              </div>
              {!isAuthenticated && !isLoading && (
                <p className="text-sm font-medium text-primary-600">
                  {t('dashboard.pleaseSignInToExploreDashboardTools')}
                </p>
              )}
            </motion.div>

            <div className="mx-auto max-w-5xl">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                {mainSections.map((section, index) => renderCard(section, index))}

                {lastRowCount > 0 && (
                  <div className="md:col-span-3">
                    <div
                      className={`flex flex-col gap-6 ${
                        lastRowCount > 1 ? 'md:flex-row md:justify-center' : 'md:items-center md:justify-center'
                      } md:gap-6`}
                    >
                      {trailingSections.map((section, sliceIndex) =>
                        renderCard(
                          section,
                          fullRowsCount + sliceIndex,
                          lastRowCount === 1 ? 'w-full md:max-w-xs' : 'w-full md:max-w-xs md:flex-1'
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
      </div>

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


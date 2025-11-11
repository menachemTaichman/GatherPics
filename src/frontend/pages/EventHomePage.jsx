import { motion } from 'framer-motion';
import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, Calendar, Image as ImageIcon, Upload, Settings } from 'lucide-react';
import PermissionGate from '../components/common/PermissionGate.jsx';
import { EditEventModal } from '../components/events';
import { APP_CONFIG } from '../config/appConfig';
import { useToast } from '../contexts/ToastContext';

export default function EventHomePage({ eventUrl, eventData }) {
  const eventName = eventData?.name || 'Event';
  const [showEventSettings, setShowEventSettings] = useState(false);
  const { showToast } = useToast();

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
      show: true
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
      show: true
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
      show: true
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
      show: true,
      requires: 'canUploadAndDeleteImages'
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
      show: true,
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
        className="container mx-auto px-4 py-20 relative z-10"
        style={{ minHeight: 'max(calc(100vh - 4rem - 10rem), 0px)' }}
      >
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12 max-w-4xl mx-auto"
        >
          <h1 className="text-4xl md:text-5xl font-semibold text-gray-900 mb-3 tracking-tight">
            {eventName}
          </h1>
          <p className="text-lg text-gray-600 leading-relaxed">
            Choose how you'd like to explore this event
          </p>
        </motion.div>

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

        {/* Footer Info */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="text-center mt-20"
        >
          <p className="text-gray-400 text-sm font-medium">
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


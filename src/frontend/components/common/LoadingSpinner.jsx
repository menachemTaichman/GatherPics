import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { APP_CONFIG } from '../../config/appConfig';
import { useRTL } from '../../hooks/useRTL';

export default function LoadingSpinner() {
  const { t } = useTranslation();
  const { isRTL } = useRTL();

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <motion.div
          className="w-16 h-16 border-4 border-primary-200 border-t-primary-600 rounded-full mx-auto mb-4"
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          {t('loadingSpinner.loading')} {APP_CONFIG.name}
        </h2>
        <p className="text-gray-600">
          {t('loadingSpinner.preparingCollection')}
        </p>
      </div>
    </div>
  );
} 



import { motion } from 'framer-motion';
import { APP_CONFIG } from '../../config/appConfig';

export default function LoadingSpinner() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <motion.div
          className="w-16 h-16 border-4 border-primary-200 border-t-primary-600 rounded-full mx-auto mb-4"
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          Loading {APP_CONFIG.name}
        </h2>
        <p className="text-gray-600">
          Preparing your beautiful face collection...
        </p>
      </div>
    </div>
  );
} 



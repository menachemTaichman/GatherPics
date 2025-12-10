import { motion, AnimatePresence } from 'framer-motion';

export default function Toast({ toast }) {
  if (!toast.show) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -50, scale: 0.9, x: '-50%' }}
        animate={{ opacity: 1, y: 0, scale: 1, x: '-50%' }}
        exit={{ opacity: 0, y: -50, scale: 0.9, x: '-50%' }}
        style={{ 
          // on top of photo swipe (100000), vaul drawer (100001), and modals within drawer (100002)
          zIndex: 100020,
          position: 'fixed',
          top: '1rem',
          left: '50%',
          pointerEvents: 'none'
        }}
        className={`px-6 py-3 rounded-lg shadow-lg text-white font-medium ${
          toast.type === 'success' 
            ? 'bg-green-500' 
            : toast.type === 'error' 
            ? 'bg-red-500' 
            : 'bg-blue-500'
        }`}
      >
        {toast.message}
      </motion.div>
    </AnimatePresence>
  );
}




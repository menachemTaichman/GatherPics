import { motion, AnimatePresence } from 'framer-motion';

export default function Toast({ toast }) {
  if (!toast.show) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -50, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -50, scale: 0.9 }}
        className={`fixed top-4 left-1/2 transform -translate-x-1/2 z-[10001] px-6 py-3 rounded-lg shadow-lg text-white font-medium ${
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




import { create } from 'zustand';

// A simple stack to manage open modals. The last one in is the active one.
const useModalStore = create((set) => ({
  stack: [],
  register: (id) => set((state) => ({ stack: [...state.stack, id] })),
  unregister: (id) => set((state) => ({ stack: state.stack.filter(sId => sId !== id) })),
}));

/**
 * Hook to interact with the global modal stack.
 * Provides functions to register/unregister modals and check if a modal is the topmost one.
 */
export const useModalManager = () => {
  const { stack, register, unregister } = useModalStore();
  
  /**
   * Checks if a given modal id is at the top of the stack.
   * @param {string} id The id of the modal to check.
   * @returns {boolean} True if the modal is the topmost, false otherwise.
   */
  const isTopModal = (id) => {
    if (stack.length === 0) return false;
    return stack[stack.length - 1] === id;
  };
  
  return { register, unregister, isTopModal };
};

import { create } from 'zustand';
import { useDataStore } from './dataManager';

// Modal manager with typed modals (popup/panel) and integrated scope handling
// Popup modals lock body scroll while any are open; panels do not.
const useModalStore = create((set, get) => ({
  stack: [], // order of modal ids
  registry: {}, // id -> { type, scopes: Array<{entity,id}> }
  popupCount: 0,

  _lockScroll: () => {
    try { document.body.style.overflow = 'hidden'; } catch {}
  },
  _unlockScroll: () => {
    try { document.body.style.overflow = ''; } catch {}
  },

  registerModal: ({ id, type = 'popup', scopes = [], allowOutsideScroll = false }) => set((state) => {
    if (!id) return {};
    const nextStack = [...state.stack, id];
    const nextRegistry = { ...state.registry, [id]: { type, scopes, allowOutsideScroll } };
    const isPopup = type === 'popup';
    const nextPopupCount = state.popupCount + (isPopup ? 1 : 0);

    // Apply scopes
    try {
      const ds = useDataStore.getState();
      (scopes || []).forEach((s) => s?.entity && ds.addScope && ds.addScope({ entity: s.entity, id: s.id }));
    } catch {}

    // Scroll lock if any popup open and none allow outside scroll
    if (nextPopupCount > 0) {
      const hasOutsideScrollAllowed = Object.values(nextRegistry).some(modal => 
        modal.type === 'popup' && modal.allowOutsideScroll
      );
      if (!hasOutsideScrollAllowed) {
        get()._lockScroll();
      }
    }

    return { stack: nextStack, registry: nextRegistry, popupCount: nextPopupCount };
  }),

  unregisterModal: (id) => set((state) => {
    if (!id) return {};
    const nextStack = state.stack.filter((sId) => sId !== id);
    const entry = state.registry[id];
    const nextRegistry = { ...state.registry };
    delete nextRegistry[id];

    // Remove scopes
    if (entry && Array.isArray(entry.scopes)) {
      try {
        const ds = useDataStore.getState();
        entry.scopes.forEach((s) => s?.entity && ds.removeScope && ds.removeScope({ entity: s.entity, id: s.id }));
      } catch {}
    }

    const decPopup = entry && entry.type === 'popup' ? 1 : 0;
    const nextPopupCount = Math.max(0, state.popupCount - decPopup);
    
    // Unlock scroll if no popups left, or if remaining popups allow outside scroll
    if (nextPopupCount === 0) {
      get()._unlockScroll();
    } else {
      const hasOutsideScrollAllowed = Object.values(nextRegistry).some(modal => 
        modal.type === 'popup' && modal.allowOutsideScroll
      );
      if (hasOutsideScrollAllowed) {
        get()._unlockScroll();
      }
    }

    return { stack: nextStack, registry: nextRegistry, popupCount: nextPopupCount };
  }),

  updateModalScopes: (id, nextScopes = []) => set((state) => {
    const entry = state.registry[id];
    if (!entry) return {};
    const prevScopes = entry.scopes || [];

    const prevKey = (s) => `${s?.entity || ''}:${s?.id ?? ''}`;
    const prevSet = new Set(prevScopes.map(prevKey));
    const nextSet = new Set((nextScopes || []).map(prevKey));

    try {
      const ds = useDataStore.getState();
      // Add new scopes
      (nextScopes || []).forEach((s) => {
        if (!s?.entity) return;
        const key = prevKey(s);
        if (!prevSet.has(key)) ds.addScope && ds.addScope({ entity: s.entity, id: s.id });
      });
      // Remove old scopes
      (prevScopes || []).forEach((s) => {
        if (!s?.entity) return;
        const key = prevKey(s);
        if (!nextSet.has(key)) ds.removeScope && ds.removeScope({ entity: s.entity, id: s.id });
      });
    } catch {}

    const nextRegistry = { ...state.registry, [id]: { ...entry, scopes: nextScopes } };
    return { registry: nextRegistry };
  }),
}));

export const useModalManager = () => {
  const { stack, registerModal, unregisterModal, updateModalScopes } = useModalStore();

  const isTopModal = (id) => {
    if (stack.length === 0) return false;
    return stack[stack.length - 1] === id;
  };

  return { registerModal, unregisterModal, updateModalScopes, isTopModal };
};

export { useModalStore };



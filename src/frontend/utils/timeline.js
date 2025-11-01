/**
 * Timeline URL Management Utility
 */

class TimelineManager {
	constructor() {
		this.isProgrammaticScroll = false;
		this.currentMomentKey = null;
		this.momentElements = new Map();
		this.visibleMoments = new Set(); // Track which moments are currently visible
		this.anchorOffset = 0;
		this.basePath = '/timeline';
		this.anchorSelector = '.sticky.top-16';
		this._resizeHandler = null;
		this._popstateHandler = null;
		this._scrollHandler = null;
		this._io = null;
		this._visibilityIO = null; // Separate observer for visibility detection
		this.onMomentChange = null; // Callback to notify React components
		this.jumpingToMoment = null; // Track which moment we're currently jumping to
		this._initialized = false; // Prevent duplicate initialization
		this.initialURLHandled = false; // Prevent duplicate URL handling
		this.scrollObserverEnabled = false; // Prevent scroll observer from running during initial navigation
	}

	init(basePath = '/timeline', anchorSelector = '.sticky.top-16', onMomentChange = null, momentsReady = false, eventId = null) {
		// Prevent duplicate initialization
		if (this._initialized) {
			return;
		}
		this._initialized = true;
		
		this.basePath = basePath;
		this.anchorSelector = anchorSelector;
		this.onMomentChange = onMomentChange;
		this.eventId = eventId;

		// Note: Individual moment scopes should not exist - only 'all:moments' scope is needed
		// Timeline manager will add/remove individual moment scopes only for UI observation optimization

		this.updateAnchorOffset();
		this.setupScrollObserver();
		this._createIntersectionObserver();
		this._createVisibilityObserver(); // Create visibility observer
		
		// Only handle initial URL if moments are ready
		if (momentsReady) {
		this.handleInitialURL();
		}

		this._resizeHandler = () => {
			this.updateAnchorOffset();
			this._recreateIntersectionObserver();
			this.syncUrlToViewport();
		};
		window.addEventListener('resize', this._resizeHandler);

		this._popstateHandler = () => {
			const key = this.getKeyFromQuery();
			if (key) {
				this.isProgrammaticScroll = true;
				this.scrollToMomentWhenReady(key);
				setTimeout(() => {
					this.isProgrammaticScroll = false;
				}, 1000);
			}
		};
		window.addEventListener('popstate', this._popstateHandler);
	}

	_createIntersectionObserver() {
		if (this._io) {
			this._io.disconnect();
		}
		// Track elements entering a band starting at anchorOffset
		const topMargin = this.anchorOffset;
		// Use a bottom margin so we focus near the top band
		const bottomMargin = Math.floor(window.innerHeight * 0.6);
		this._io = new IntersectionObserver((entries) => {
			if (this.isProgrammaticScroll) return;
			let best = null;
			let bestRatio = 0;
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				const key = entry.target.dataset.momentKey;
				if (!key) continue;
				// Prefer the one with highest intersection ratio
				if (entry.intersectionRatio > bestRatio) {
					bestRatio = entry.intersectionRatio;
					best = key;
				}
			}
			if (best && best !== this.currentMomentKey) {
				this.updateURLFromScroll(best);
			}
		}, {
			root: null,
			rootMargin: `-${topMargin}px 0px -${bottomMargin}px 0px`,
			threshold: [0, 0.01, 0.1, 0.25, 0.5, 0.75, 1]
		});

		// Observe any already-registered elements
		this.momentElements.forEach((el) => {
			try { this._io.observe(el); } catch {}
		});
	}

	_createVisibilityObserver() {
		if (this._visibilityIO) {
			this._visibilityIO.disconnect();
		}
		
		// Observer to detect which moments are visible in viewport
		this._visibilityIO = new IntersectionObserver((entries) => {
			for (const entry of entries) {
				const key = entry.target.dataset.momentKey;
				if (!key) continue;
				
				if (entry.isIntersecting) {
					// Moment became visible - register it
					this.visibleMoments.add(key);
					this.registerMomentForScroll(key, entry.target);
				} else {
					// Moment left viewport - unregister it
					this.visibleMoments.delete(key);
					this.unregisterMomentFromScroll(key);
				}
			}
		}, {
			root: null,
			rootMargin: '50px 0px 50px 0px', // Small buffer for smooth scrolling
			threshold: [0, 0.1]
		});
	}

	_recreateIntersectionObserver() {
		this._createIntersectionObserver();
	}

	getKeyFromQuery() {
		const urlParams = new URLSearchParams(window.location.search);
		return urlParams.get('moment');
	}

	buildUrlWithMoment(momentKey) {
		const current = new URL(window.location.href);
		current.pathname = this.basePath;
		// Build query string manually to ensure spaces are encoded as %20 (encodeURIComponent)
		const pairs = [];
		// Keep existing params except 'moment'
		current.searchParams.forEach((value, key) => {
			if (key === 'moment') return;
			pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
		});
		// Put moment first for readability
		pairs.unshift(`moment=${encodeURIComponent(momentKey)}`);
		const query = pairs.length ? `?${pairs.join('&')}` : '';
		return `${current.pathname}${query}`;
	}

	syncUrlToViewport() {
		if (this.isProgrammaticScroll || this.momentElements.size === 0 || !this.scrollObserverEnabled) {
			return;
		}
		let bestCandidate = null;
		let bestScore = -1;
		const anchorY = this.anchorOffset;
		
		this.momentElements.forEach((element, momentKey) => {
			const rect = element.getBoundingClientRect();
			if (rect.top <= anchorY + 150 && rect.bottom > anchorY) {
				const distance = Math.abs(rect.top - anchorY);
				const score = 1 / (1 + distance);
				if (score > bestScore) {
					bestScore = score;
					bestCandidate = momentKey;
				}
			}
		});
		
		if (bestCandidate && bestCandidate !== this.currentMomentKey) {
			this.updateURLFromScroll(bestCandidate);
		}
	}

	updateAnchorOffset() {
		const anchorElement = document.querySelector(this.anchorSelector);
		const headerHeight = anchorElement ? anchorElement.offsetHeight : 0;
		// Use minimal padding to show the moment header section (not the container top)
		this.anchorOffset = headerHeight + 70;
	}

	recalculateOffset() {
		setTimeout(() => {
			this.updateAnchorOffset();
			this._recreateIntersectionObserver();
			this.syncUrlToViewport();
		}, 350);
	}

	setupScrollObserver() {
		let lastScrollY = window.pageYOffset;
		let scrollDirection = 'none';
		
		const handleScroll = () => {
			if (this.isProgrammaticScroll) return;
			
			const currentScrollY = window.pageYOffset;
			scrollDirection = currentScrollY > lastScrollY ? 'down' : 'up';
			lastScrollY = currentScrollY;
			
			// Find the best moment based on scroll direction
			let bestCandidate = null;
			let bestScore = -1;
			let closestFallback = null;
			let closestDistance = Infinity;
			
			this.momentElements.forEach((element, momentKey) => {
				const rect = element.getBoundingClientRect();
				const anchorY = this.anchorOffset;
				const distanceFromAnchor = Math.abs(rect.top - anchorY);
				if (distanceFromAnchor < closestDistance) {
					closestDistance = distanceFromAnchor;
					closestFallback = { element, momentKey };
				}
				
				if (scrollDirection === 'down') {
					if (rect.top <= anchorY + 150 && rect.bottom > anchorY) {
						const distance = Math.abs(rect.top - anchorY);
						const score = 1 / (1 + distance);
						
						if (score > bestScore) {
							bestScore = score;
							bestCandidate = { element, momentKey };
						}
					}
				} else if (scrollDirection === 'up') {
					if (rect.top <= anchorY + 50) {
						const distance = Math.abs(rect.top - anchorY);
						const score = 1 / (1 + distance);
						
						if (score > bestScore) {
							bestScore = score;
							bestCandidate = { element, momentKey };
						}
					}
				}
			});
			
			const chosen = bestCandidate || closestFallback;
			if (chosen && chosen.momentKey !== this.currentMomentKey) {
				this.updateURLFromScroll(chosen.momentKey);
			}
		};
		
		let ticking = false;
		const throttledScroll = () => {
			if (!ticking) {
				requestAnimationFrame(() => {
					handleScroll();
					ticking = false;
				});
				ticking = true;
			}
		};
		
		window.addEventListener('scroll', throttledScroll, { passive: true });
		this._scrollHandler = throttledScroll;

	// Don't call syncUrlToViewport immediately - wait for initial URL handling to complete
	// This prevents the observer from overriding the URL parameter navigation
	}

	registerMoment(momentKey, element) {
		if (element && momentKey) {
			element.dataset.momentKey = momentKey;
			this.momentElements.set(momentKey, element);
			
			// Add to visibility observer to detect when it becomes visible
			if (this._visibilityIO) {
				try { this._visibilityIO.observe(element); } catch {}
			}
			
			// Check if it's already visible and register for scroll detection
			const rect = element.getBoundingClientRect();
			const isVisible = rect.top < window.innerHeight && rect.bottom > 0;
			if (isVisible) {
				this.visibleMoments.add(momentKey);
				this.registerMomentForScroll(momentKey, element);
			}
		}
	}

	unregisterMoment(momentKey) {
		const el = this.momentElements.get(momentKey);
		
		// Remove from visibility observer
		if (this._visibilityIO && el) {
			try { this._visibilityIO.unobserve(el); } catch {}
		}
		
		// Remove from scroll observer
		this.unregisterMomentFromScroll(momentKey);
		
		// Clean up
		this.momentElements.delete(momentKey);
		this.visibleMoments.delete(momentKey);
	}

	registerMomentForScroll(momentKey, element) {
		if (this._io && element) {
			try { this._io.observe(element); } catch {}
		}
		
		// Add to data store scope
		this.addMomentToDataStoreScope(momentKey);
		
		requestAnimationFrame(() => this.syncUrlToViewport());
	}

	unregisterMomentFromScroll(momentKey) {
		const el = this.momentElements.get(momentKey);
		if (this._io && el) {
			try { this._io.unobserve(el); } catch {}
		}
		
		// Remove from data store scope
		this.removeMomentFromDataStoreScope(momentKey);
	}

	addMomentToDataStoreScope(momentKey) {
		// Find the moment ID from the momentKey (label)
		const momentElement = this.momentElements.get(momentKey);
		if (momentElement) {
			const momentId = momentElement.dataset.momentId;
			if (momentId) {
				// Actually add to data store scope
				try {
					const dataStore = window.__dataStore?.getState();
					if (dataStore?.addScope) {
						dataStore.addScope({ entity: 'moment', id: momentId, eventId: this.eventId });
						
						// Trigger API call to load moment data (including images)
						this.loadMomentData(momentId);
					}
				} catch (error) {
					// Silent error handling
				}
			}
		}
	}

	async loadMomentData(momentId) {
		try {
			// Import the API dynamically to avoid circular dependencies
			const { momentsAPI } = await import('./apiService');
			const eventUrl = window.location.pathname.split('/')[1]; // Extract event URL from path
			const response = await momentsAPI.getById(momentId, eventUrl);
		} catch (error) {
			// Silent error handling
		}
	}

	removeMomentFromDataStoreScope(momentKey) {
		// Find the moment ID from the momentKey (label)
		const momentElement = this.momentElements.get(momentKey);
		if (momentElement) {
			const momentId = momentElement.dataset.momentId;
			if (momentId) {
				// Actually remove from data store scope
				try {
					const dataStore = window.__dataStore?.getState();
					if (dataStore?.removeScope) {
						dataStore.removeScope({ entity: 'moment', id: momentId, eventId: this.eventId });
					}
				} catch (error) {
					// Silent error handling
				}
			}
		}
	}

	clearAllMomentScopes() {
		try {
			const dataStore = window.__dataStore?.getState();
			if (dataStore?.scopes && this.eventId) {
				// Get all moment scopes for this event and remove them
				const scopePrefix = `${this.eventId}:moment:`;
				const momentScopes = Object.keys(dataStore.scopes).filter(key => key.startsWith(scopePrefix));
				momentScopes.forEach(scopeKey => {
					const [eventId, entity, id] = scopeKey.split(':');
					if (dataStore.removeScope) {
						dataStore.removeScope({ entity, id, eventId });
					}
				});
			}
		} catch (error) {
			// Silent error handling
		}
	}

	updateURLFromScroll(momentKey) {
		if (this.isProgrammaticScroll || !this.scrollObserverEnabled) {
			return;
		}
		
		this.currentMomentKey = momentKey;
		const newURL = this.buildUrlWithMoment(momentKey);
		window.history.replaceState(
			{ momentKey, source: 'scroll' },
			'',
			newURL
		);
		if (this.onMomentChange) {
			this.onMomentChange(momentKey);
		}
	}

	navigateToMoment(momentKey, momentName) {
		if (!momentKey) return;
		this.isProgrammaticScroll = true;
		const newURL = this.buildUrlWithMoment(momentKey);
		window.history.pushState(
			{ momentKey, source: 'navigation', momentName },
			momentName || momentKey,
			newURL
		);
		this.currentMomentKey = momentKey;
		if (this.onMomentChange) {
			this.onMomentChange(momentKey);
		}
		this.scrollToMomentWhenReady(momentKey);
		setTimeout(() => {
			this.isProgrammaticScroll = false;
		}, 1000);
	}

	scrollToElement(element) {
		if (!element) return;
		const rect = element.getBoundingClientRect();
		const elementTop = rect.top + window.pageYOffset;
		const targetScroll = elementTop - this.anchorOffset;
		
		// Instant jump to target position
		window.scrollTo({
			top: Math.max(0, targetScroll),
			behavior: 'instant'
		});
		
		// Add jump animation effect
		this.addJumpAnimation(element);
	}

	addJumpAnimation(element) {
		// Add CSS classes for animation
		element.style.transition = 'opacity 0.3s ease-out, transform 0.3s ease-out';
		element.style.opacity = '0.7';
		element.style.transform = 'scale(0.98)';
		
		// Animate back to normal
		requestAnimationFrame(() => {
			element.style.opacity = '1';
			element.style.transform = 'scale(1)';
			
			// Clean up after animation
			setTimeout(() => {
				element.style.transition = '';
				element.style.opacity = '';
				element.style.transform = '';
			}, 300);
		});
	}

	scrollToMomentWhenReady(momentKey, attempt = 0) {
		const MAX_ATTEMPTS = 30;
		
		// Prevent duplicate jump calls
		if (this.jumpingToMoment === momentKey) {
			return;
		}
		
		const element = this.momentElements.get(momentKey);
		
		if (element) {
			this.jumpingToMoment = momentKey;
			this.scrollToElement(element);
			// Clear the jumping flag after animation completes
			setTimeout(() => {
				this.jumpingToMoment = null;
			}, 500);
			return;
		}
		if (attempt >= MAX_ATTEMPTS) {
			this.jumpingToMoment = null;
			return;
		}
		setTimeout(() => this.scrollToMomentWhenReady(momentKey, attempt + 1), 100);
	}

	handleInitialURL() {
		const key = this.getKeyFromQuery();
		if (key && !this.initialURLHandled) {
			this.initialURLHandled = true; // Prevent multiple executions
			this.currentMomentKey = key; // Set current moment for info box
			
			// Update info box immediately
			if (this.onMomentChange) {
				this.onMomentChange(key);
			}
			
			// Delay to ensure carousel animations complete before calculating anchor offset
			setTimeout(() => {
				// Ensure anchor offset is calculated after carousel state is stable
				this.updateAnchorOffset();
				this.isProgrammaticScroll = true;
				this.scrollToMomentWhenReady(key);
				setTimeout(() => {
					this.isProgrammaticScroll = false;
				}, 1000);
			}, 800);
		}
	}

	// Method to call when moments are loaded and ready
	handleMomentsReady() {
		this.handleInitialURL();
		
		// Enable scroll observer after initial URL handling is complete
		setTimeout(() => {
			this.scrollObserverEnabled = true;
			this.syncUrlToViewport();
		}, 1000); // Wait for scroll animation to complete
	}

	destroy() {
		if (this._io) {
			try { this._io.disconnect(); } catch {}
			this._io = null;
		}
		if (this._visibilityIO) {
			try { this._visibilityIO.disconnect(); } catch {}
			this._visibilityIO = null;
		}
		if (this._scrollHandler) {
			window.removeEventListener('scroll', this._scrollHandler);
		}
		this.momentElements.clear();
		this.visibleMoments.clear();
		if (this._resizeHandler) {
			window.removeEventListener('resize', this._resizeHandler);
		}
		if (this._popstateHandler) {
			window.removeEventListener('popstate', this._popstateHandler);
		}
		
		// Reset initialization flag to allow reinitialization on page refresh
		this._initialized = false;
		this.jumpingToMoment = null;
		this.currentMomentKey = null;
		this.isProgrammaticScroll = false;
		this.initialURLHandled = false;
		this.scrollObserverEnabled = false;
	}

	refreshElements() {
		// Clear all existing elements and recreate observers
		this.momentElements.clear();
		this.visibleMoments.clear();
		if (this._io) {
			try { this._io.disconnect(); } catch {}
		}
		if (this._visibilityIO) {
			try { this._visibilityIO.disconnect(); } catch {}
		}
		this._createIntersectionObserver();
		this._createVisibilityObserver();
		
		// Reset state for fresh start
		this.jumpingToMoment = null;
		this.currentMomentKey = null;
		this.isProgrammaticScroll = false;
	}
}

const timelineManager = new TimelineManager();
export default timelineManager;




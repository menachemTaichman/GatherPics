/**
 * Timeline URL Management Utility
 */

class TimelineManager {
	constructor() {
		this.isProgrammaticScroll = false;
		this.currentMomentKey = null;
		this.momentElements = new Map();
		this.anchorOffset = 0;
		this.basePath = '/timeline';
		this.anchorSelector = '.sticky.top-16';
		this._resizeHandler = null;
		this._popstateHandler = null;
		this._scrollHandler = null;
		this.onMomentChange = null; // Callback to notify React components
	}

	init(basePath = '/timeline', anchorSelector = '.sticky.top-16', onMomentChange = null) {
		this.basePath = basePath;
		this.anchorSelector = anchorSelector;
		this.onMomentChange = onMomentChange;

		this.updateAnchorOffset();
		this.setupScrollObserver();
		this.handleInitialURL();

		this._resizeHandler = () => this.updateAnchorOffset();
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

	getKeyFromQuery() {
		const urlParams = new URLSearchParams(window.location.search);
		return urlParams.get('moment');
	}

	updateAnchorOffset() {
		const anchorElement = document.querySelector(this.anchorSelector);
		const headerHeight = anchorElement ? anchorElement.offsetHeight : 0;
		
		// Use minimal padding to show exact start of moment
		this.anchorOffset = headerHeight + 80;
	}

	// Method to recalculate offset when carousel visibility changes
	recalculateOffset() {
		// Use a longer delay to ensure animations complete
		setTimeout(() => {
			this.updateAnchorOffset();
		}, 350); // Wait for AnimatePresence animation (300ms) + buffer
	}

	setupScrollObserver() {
		// Track scroll direction
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
			
			this.momentElements.forEach((element, momentKey) => {
				const rect = element.getBoundingClientRect();
				const anchorY = this.anchorOffset;
				
				// Different logic for different scroll directions
				if (scrollDirection === 'down') {
					// When scrolling down, look for moments approaching the anchor point
					if (rect.top <= anchorY + 150 && rect.bottom > anchorY) {
						const distance = Math.abs(rect.top - anchorY);
						const score = 1 / (1 + distance);
						
						if (score > bestScore) {
							bestScore = score;
							bestCandidate = { element, momentKey };
						}
					}
				} else if (scrollDirection === 'up') {
					// When scrolling up, look for moments above the anchor point
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
			
			if (bestCandidate && bestCandidate.momentKey !== this.currentMomentKey) {
				this.updateURLFromScroll(bestCandidate.momentKey);
			}
		};
		
		// Use throttled scroll handler for better performance
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
		
		// Store the scroll handler for cleanup
		this._scrollHandler = throttledScroll;
	}

	registerMoment(momentKey, element) {
		if (element && momentKey) {
			element.dataset.momentKey = momentKey;
			this.momentElements.set(momentKey, element);
		}
	}

	unregisterMoment(momentKey) {
		this.momentElements.delete(momentKey);
	}

	updateURLFromScroll(momentKey) {
		if (this.isProgrammaticScroll) return;
				
		this.currentMomentKey = momentKey;
		const newURL = `${this.basePath}?moment=${encodeURIComponent(momentKey)}`;
		
		// Use replaceState to avoid flooding history
		window.history.replaceState(
			{ momentKey, source: 'scroll' },
			'',
			newURL
		);
		
		// Notify React component about moment change
		if (this.onMomentChange) {
			this.onMomentChange(momentKey);
		}
	}

	navigateToMoment(momentKey, momentName) {
		if (!momentKey) return;
		
		this.isProgrammaticScroll = true;
		const newURL = `${this.basePath}?moment=${encodeURIComponent(momentKey)}`;
		
		// Use pushState to create history entry
		window.history.pushState(
			{ momentKey, source: 'navigation', momentName },
			momentName || momentKey,
			newURL
		);
		
		// Update current moment key
		this.currentMomentKey = momentKey;
		
		// Notify React component
		if (this.onMomentChange) {
			this.onMomentChange(momentKey);
		}
		
		// Scroll to the moment
		this.scrollToMomentWhenReady(momentKey);
		
		// Re-enable scroll detection after a delay
		setTimeout(() => {
			this.isProgrammaticScroll = false;
		}, 1000);
	}

	scrollToElement(element) {
		if (!element) return;
		
		const rect = element.getBoundingClientRect();
		const elementTop = rect.top + window.pageYOffset;
		// Position moment with proper padding at the top
		const targetScroll = elementTop - this.anchorOffset;
		
		window.scrollTo({
			top: Math.max(0, targetScroll),
			behavior: 'smooth'
		});
	}

	scrollToMomentWhenReady(momentKey, attempt = 0) {
		const MAX_ATTEMPTS = 30;
		const element = this.momentElements.get(momentKey);
		
		if (element) {
			this.scrollToElement(element);
			return;
		}
		
		if (attempt >= MAX_ATTEMPTS) {
			return;
		}
		
		setTimeout(() => this.scrollToMomentWhenReady(momentKey, attempt + 1), 100);
	}

	handleInitialURL() {
		const key = this.getKeyFromQuery();
		if (key) {
			setTimeout(() => {
				this.isProgrammaticScroll = true;
				this.scrollToMomentWhenReady(key);
				setTimeout(() => {
					this.isProgrammaticScroll = false;
				}, 1000);
			}, 300);
		}
	}

	destroy() {
		if (this.scrollObserver) {
			this.scrollObserver.disconnect();
		}
		if (this._scrollHandler) {
			window.removeEventListener('scroll', this._scrollHandler);
		}
		this.momentElements.clear();
		if (this._resizeHandler) {
			window.removeEventListener('resize', this._resizeHandler);
		}
		if (this._popstateHandler) {
			window.removeEventListener('popstate', this._popstateHandler);
		}
	}
}

const timelineManager = new TimelineManager();
export default timelineManager;

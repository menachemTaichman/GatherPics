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
		this._io = null;
		this.onMomentChange = null; // Callback to notify React components
	}

	init(basePath = '/timeline', anchorSelector = '.sticky.top-16', onMomentChange = null) {
		this.basePath = basePath;
		this.anchorSelector = anchorSelector;
		this.onMomentChange = onMomentChange;

		this.updateAnchorOffset();
		this.setupScrollObserver();
		this._createIntersectionObserver();
		this.handleInitialURL();

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
		if (this.isProgrammaticScroll || this.momentElements.size === 0) return;
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
		
		// Use minimal padding to show exact start of moment
		this.anchorOffset = headerHeight + 80;
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

		setTimeout(() => {
			this.syncUrlToViewport();
		}, 0);
	}

	registerMoment(momentKey, element) {
		if (element && momentKey) {
			element.dataset.momentKey = momentKey;
			this.momentElements.set(momentKey, element);
			try { if (this._io) this._io.observe(element); } catch {}
			requestAnimationFrame(() => this.syncUrlToViewport());
		}
	}

	unregisterMoment(momentKey) {
		const el = this.momentElements.get(momentKey);
		if (this._io && el) {
			try { this._io.unobserve(el); } catch {}
		}
		this.momentElements.delete(momentKey);
		requestAnimationFrame(() => this.syncUrlToViewport());
	}

	updateURLFromScroll(momentKey) {
		if (this.isProgrammaticScroll) return;
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
		if (this._io) {
			try { this._io.disconnect(); } catch {}
			this._io = null;
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

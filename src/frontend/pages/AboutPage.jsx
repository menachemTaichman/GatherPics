import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FileText, Shield, Accessibility, Info, MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { TopNavigationBar } from '../components/layout';
import { FeedbackFormModal } from '../components/feedbacks';
import { LongPressHoverButton } from '../components/common';
import { APP_CONFIG } from '../config/appConfig';
import { useRTL } from '../hooks/useRTL';

function MarkdownSection({ content, title, navigate, onStickyH2Change, t, isRTL }) {
  const h2Refs = useRef({});
  const [stickyH2, setStickyH2] = useState(null);

  useEffect(() => {
    const handleScroll = () => {
      // Find the current h2 that should be sticky
      const h2Elements = Object.values(h2Refs.current).filter(Boolean);
      
      if (h2Elements.length === 0) {
        setStickyH2(null);
        return;
      }

      let currentSticky = null;
      const stickyThreshold = 80; // Position where header should become sticky (accounting for main header ~64px)

      // Find the last h2 that has scrolled past the threshold
      for (let i = h2Elements.length - 1; i >= 0; i--) {
        const h2 = h2Elements[i];
        if (!h2) continue;
        
        const rect = h2.getBoundingClientRect();
        
        // If h2 is at or above the sticky position, make it sticky
        // Also check that the next h2 hasn't pushed it out
        if (rect.top <= stickyThreshold) {
          // Check if there's a next h2 that would replace this one
          let shouldBeSticky = true;
          if (i < h2Elements.length - 1) {
            const nextH2 = h2Elements[i + 1];
            if (nextH2) {
              const nextRect = nextH2.getBoundingClientRect();
              // If next h2 is also past threshold, use that one instead
              if (nextRect.top <= stickyThreshold) {
                shouldBeSticky = false;
              }
            }
          }
          
          if (shouldBeSticky) {
            currentSticky = h2;
            break;
          }
        }
      }

      setStickyH2(currentSticky);
      // Notify parent of sticky h2 change
      if (onStickyH2Change) {
        const stickyKey = currentSticky ? Object.keys(h2Refs.current).find(key => h2Refs.current[key] === currentSticky) : null;
        const stickyText = currentSticky ? currentSticky.textContent : null;
        onStickyH2Change({ element: currentSticky, key: stickyKey, text: stickyText });
      }
    };

    // Add a small delay to ensure refs are set
    const timeoutId = setTimeout(() => {
      handleScroll();
    }, 100);

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Check initial state
    
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('scroll', handleScroll);
    };
  }, [content]);

  if (!content || content.trim() === '') {
    return (
      <div className="prose prose-gray max-w-none">
        <p className="text-gray-500 italic">{t('about.contentComingSoon')}</p>
      </div>
    );
  }

  // Simple markdown rendering (basic support for headers, paragraphs, lists, bold, italic, links, horizontal rules)
  const renderMarkdown = (text) => {
    const lines = text.split('\n');
    const elements = [];
    let currentParagraph = [];
    let inList = false;
    let listItems = [];
    let h2Index = 0;
    let elementIndex = 0; // Unique counter for all elements
    let quickSummary = null; // Store quick summary separately

    // Helper function to process inline markdown (bold, italic, links, etc.)
    const processInlineMarkdown = (text) => {
      const parts = [];
      let processedText = text;
      let key = 0;

      // Process in order: bold first, then links, then italic
      // This ensures nested formatting works correctly

      // Step 1: Process bold text (**text**) - must come before italic
      const boldMatches = [];
      const boldRegex = /\*\*(.+?)\*\*/g;
      let match;
      while ((match = boldRegex.exec(text)) !== null) {
        boldMatches.push({
          start: match.index,
          end: match.index + match[0].length,
          content: match[1],
          type: 'bold'
        });
      }

      // Step 2: Process links [text](/url)
      const linkMatches = [];
      const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      while ((match = linkRegex.exec(text)) !== null) {
        linkMatches.push({
          start: match.index,
          end: match.index + match[0].length,
          text: match[1],
          url: match[2],
          type: 'link'
        });
      }

      // Step 3: Process italic text (*text*) - but not if it's part of bold or link
      const italicMatches = [];
      // Find all potential italic matches (single asterisks)
      const italicRegex = /\*([^*]+?)\*/g;
      while ((match = italicRegex.exec(text)) !== null) {
        // Check if this match overlaps with any bold or link match
        const overlaps = boldMatches.some(b => 
          match.index >= b.start && match.index < b.end
        ) || linkMatches.some(l => 
          match.index >= l.start && match.index < l.end
        );
        
        // Also check if it's actually part of a bold (double asterisk)
        const isPartOfBold = text[match.index - 1] === '*' || text[match.index + match[0].length] === '*';
        
        if (!overlaps && !isPartOfBold) {
          italicMatches.push({
            start: match.index,
            end: match.index + match[0].length,
            content: match[1],
            type: 'italic'
          });
        }
      }

      // Combine all matches and sort by position
      const allMatches = [...boldMatches, ...linkMatches, ...italicMatches].sort((a, b) => a.start - b.start);

      // Build the parts array
      let lastIndex = 0;
      for (const match of allMatches) {
        // Add text before the match
        if (match.start > lastIndex) {
          const beforeText = text.substring(lastIndex, match.start);
          if (beforeText) {
            parts.push(beforeText);
          }
        }

        // Add the matched element
        if (match.type === 'bold') {
          // For bold content, process italic if present, otherwise just render text
          const boldContent = match.content;
          // Simple check for italic within bold (single asterisk not part of double)
          const italicMatch = boldContent.match(/\*([^*]+?)\*/);
          if (italicMatch && !boldContent.includes('**')) {
            const beforeItalic = boldContent.substring(0, italicMatch.index);
            const afterItalic = boldContent.substring(italicMatch.index + italicMatch[0].length);
            parts.push(
              <strong key={`inline-${key++}`} className="font-semibold text-gray-900">
                {beforeItalic}
                <em className="italic">{italicMatch[1]}</em>
                {afterItalic}
              </strong>
            );
          } else {
            parts.push(
              <strong key={`inline-${key++}`} className="font-semibold text-gray-900">
                {boldContent}
              </strong>
            );
          }
        } else if (match.type === 'link') {
          // Handle internal hash links to sections
          const handleLinkClick = (e) => {
            if (match.url.startsWith('/about#')) {
              e.preventDefault();
              const hash = match.url.replace('/about#', '');
              navigate(`/about#${hash}`, { replace: false });
            } else if (match.url.startsWith('#')) {
              e.preventDefault();
              const hash = match.url.slice(1);
              navigate(`/about#${hash}`, { replace: false });
            }
          };
          parts.push(
            <a 
              key={`inline-${key++}`} 
              href={match.url}
              onClick={handleLinkClick}
              className="text-blue-600 hover:text-blue-800 underline"
            >
              {match.text}
            </a>
          );
        } else if (match.type === 'italic') {
          parts.push(
            <em key={`inline-${key++}`} className="italic">
              {match.content}
            </em>
          );
        }

        lastIndex = match.end;
      }

      // Add remaining text
      if (lastIndex < text.length) {
        parts.push(text.substring(lastIndex));
      }

      return parts.length > 0 ? parts : [text];
    };

    const flushParagraph = () => {
      if (currentParagraph.length > 0) {
        const paragraphText = currentParagraph.join(' ');
        elements.push(
          <p key={`p-${elementIndex++}`} className="mb-4 text-gray-700 leading-relaxed">
            {processInlineMarkdown(paragraphText)}
          </p>
        );
        currentParagraph = [];
      }
    };

    const flushList = () => {
      if (listItems.length > 0) {
        const listKey = `ul-${elementIndex++}`;
        elements.push(
          <ul key={listKey} className="list-disc list-inside mb-4 space-y-2 text-gray-700">
            {listItems.map((item, idx) => (
              <li key={`${listKey}-item-${idx}`}>{processInlineMarkdown(item)}</li>
            ))}
          </ul>
        );
        listItems = [];
      }
      inList = false;
    };

    let collectingSummary = false;
    
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      
      // Quick Summary detection - start collecting
      // Check for both English and translated versions to support markdown files in either language
      const quickSummaryLabel = t('about.quickSummary');
      const quickSummaryEn = 'Quick Summary'; // English fallback
      
      // Try translated version first, then English fallback
      let summaryPrefix = null;
      if (trimmed.startsWith(`**${quickSummaryLabel}:**`)) {
        summaryPrefix = `**${quickSummaryLabel}:**`;
      } else if (trimmed.startsWith(`**${quickSummaryLabel}**`)) {
        summaryPrefix = `**${quickSummaryLabel}**`;
      } else if (trimmed.startsWith(`**${quickSummaryEn}:**`)) {
        summaryPrefix = `**${quickSummaryEn}:**`;
      } else if (trimmed.startsWith(`**${quickSummaryEn}**`)) {
        summaryPrefix = `**${quickSummaryEn}**`;
      }
      
      if (summaryPrefix) {
        flushList();
        flushParagraph();
        // Extract summary text (remove the prefix)
        const summaryText = trimmed.substring(summaryPrefix.length).trim();
        quickSummary = summaryText;
        collectingSummary = true;
        return; // Skip normal processing
      }
      
      // If we're collecting quick summary
      if (collectingSummary) {
        // Stop collecting on horizontal rule or empty line (but allow one empty line)
        if (trimmed === '---' || trimmed.match(/^-{3,}$/)) {
          collectingSummary = false;
          return; // Skip the horizontal rule in normal processing
        }
        
        // Continue collecting if line has content
        if (trimmed) {
          quickSummary += ' ' + trimmed;
          return; // Skip normal processing
        } else {
          // Empty line - stop collecting
          collectingSummary = false;
          return; // Skip the empty line
        }
      }
      
      // Horizontal rule (---)
      if (trimmed === '---' || trimmed.match(/^-{3,}$/)) {
        flushList();
        flushParagraph();
        elements.push(
          <hr key={`hr-${elementIndex++}`} className="my-6 border-gray-300" />
        );
      }
      // Headers
      else if (trimmed.startsWith('# ')) {
        flushList();
        flushParagraph();
        const headerText = trimmed.substring(2);
        elements.push(
          <h2 key={`h2-${elementIndex++}`} className="text-2xl font-semibold text-gray-900 mt-8 mb-4">
            {processInlineMarkdown(headerText)}
          </h2>
        );
      } else if (trimmed.startsWith('## ')) {
        flushList();
        flushParagraph();
        const headerText = trimmed.substring(3);
        const h2Key = `h2-${h2Index++}`;
        const elementKey = `element-${elementIndex++}`;
        const h2Ref = (el) => {
          if (el) {
            h2Refs.current[h2Key] = el;
          } else {
            delete h2Refs.current[h2Key];
          }
        };
        elements.push(
          <div key={elementKey} className="relative">
            <h3 
              ref={h2Ref}
              className="text-xl font-semibold text-gray-900 mt-6 mb-3"
              data-h2-key={h2Key}
            >
              {processInlineMarkdown(headerText)}
            </h3>
          </div>
        );
      } else if (trimmed.startsWith('### ')) {
        flushList();
        flushParagraph();
        const headerText = trimmed.substring(4);
        elements.push(
          <h4 key={`h4-${elementIndex++}`} className="text-lg font-semibold text-gray-900 mt-4 mb-2">
            {processInlineMarkdown(headerText)}
          </h4>
        );
      }
      // List items
      else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        flushParagraph();
        if (!inList) {
          inList = true;
        }
        listItems.push(trimmed.substring(2));
      }
      // Empty line
      else if (trimmed === '') {
        flushList();
        flushParagraph();
      }
      // Regular paragraph text
      else {
        flushList();
        if (trimmed) {
          currentParagraph.push(trimmed);
        }
      }
    });

    flushList();
    flushParagraph();

    // Add Quick Summary box at the beginning if it exists
    if (quickSummary) {
      const summaryKey = `quick-summary-${elementIndex++}`;
      // Use border-start for RTL support (border-l-4 in LTR, border-r-4 in RTL)
      const borderClass = isRTL ? 'border-r-4' : 'border-l-4';
      elements.unshift(
        <div 
          key={summaryKey}
          dir={isRTL ? 'rtl' : 'ltr'}
          className={`bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 ${borderClass} border-blue-500 rounded-lg p-6 mb-8 shadow-sm`}
        >
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-1">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">{t('about.quickSummary')}</h3>
              <p className="text-gray-700 leading-relaxed">
                {processInlineMarkdown(quickSummary)}
              </p>
            </div>
          </div>
        </div>
      );
    }

    return elements;
  };

  return (
    <div className="prose prose-gray max-w-none">
      {renderMarkdown(content)}
    </div>
  );
}

export default function AboutPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { isRTL, start } = useRTL();
  const [activeSection, setActiveSection] = useState('about');
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [showStickyHeader, setShowStickyHeader] = useState(false);
  const contentHeaderRef = useRef(null);
  const sectionRefs = useRef({});
  const sidebarRef = useRef(null);
  const sidebarContainerRef = useRef(null);
  const prevLanguageRef = useRef(i18n.language);
  const [stickyH2Info, setStickyH2Info] = useState(null);
  const [sidebarStyle, setSidebarStyle] = useState({});
  const [markdownContent, setMarkdownContent] = useState({
    about: '',
    terms: '',
    privacy: '',
    accessibility: ''
  });

  // Prevent default hash scroll behavior
  useEffect(() => {
    if (location.hash) {
      // Prevent browser's default scroll to hash
      const hash = location.hash.slice(1);
      const validSections = ['about', 'terms', 'privacy', 'accessibility'];
      if (validSections.includes(hash)) {
        setActiveSection(hash);
        // Prevent default scroll
        window.history.scrollRestoration = 'manual';
        if (window.scrollY === 0) {
          window.scrollTo(0, 0);
        }
      }
    }
  }, [location.hash]);

  // Update URL hash when section changes
  useEffect(() => {
    if (activeSection) {
      navigate(`/about#${activeSection}`, { replace: true });
    }
  }, [activeSection, navigate]);

  // Prevent scroll on mount if hash is present
  useEffect(() => {
    if (location.hash) {
      window.scrollTo(0, 0);
    }
  }, []);

  useEffect(() => {
    document.title = `${t('about.about')} | ${APP_CONFIG.name}`;
    
    // Load markdown files based on current i18n language
    const loadMarkdown = async () => {
      try {
        const lang = i18n.language || 'en';
        const [aboutRes, termsRes, privacyRes, accessibilityRes] = await Promise.all([
          fetch(`/content/about.${lang}.md`).catch(() => null),
          fetch(`/content/terms.${lang}.md`).catch(() => null),
          fetch(`/content/privacy.${lang}.md`).catch(() => null),
          fetch(`/content/accessibility.${lang}.md`).catch(() => null)
        ]);

        const content = {
          about: aboutRes ? await aboutRes.text() : '',
          terms: termsRes ? await termsRes.text() : '',
          privacy: privacyRes ? await privacyRes.text() : '',
          accessibility: accessibilityRes ? await accessibilityRes.text() : ''
        };

        setMarkdownContent(content);
      } catch (error) {
        console.error('Error loading markdown files:', error);
      }
    };

    loadMarkdown();
  }, [i18n.language]);

  // Manual sticky implementation for sidebar (CSS Grid interferes with native sticky)
  // Only apply on desktop (lg breakpoint and above, typically 1024px)
  useEffect(() => {
    const sidebar = sidebarRef.current;
    const container = sidebarContainerRef.current;
    
    if (!sidebar || !container) return;
    
    // Check if we're on mobile (below lg breakpoint)
    const isMobile = () => window.innerWidth < 1024;
    
    // On mobile, ensure sidebar is in normal flow
    if (isMobile()) {
      setSidebarStyle({});
      return;
    }
    
    // Compute direction string once based on current isRTL value
    const direction = isRTL ? 'right' : 'left';
    
    let isSticky = false;
    let initialStart = 0; // RTL-aware start position (left in LTR, right in RTL)
    let initialWidth = 0;
    let initialTop = 0;
    
    const handleScroll = () => {
      // Reset to normal flow on mobile
      if (isMobile()) {
        if (isSticky) {
          isSticky = false;
          setSidebarStyle({});
        }
        return;
      }
      
      const sidebarRect = sidebar.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const headerHeight = 64; // Header height
      const containerPadding = 24; // pt-6 = 24px
      const stickyTop = headerHeight + containerPadding; // 88px
      
      // Check if sidebar's top is at or just above sticky position
      // Switch when sidebar reaches the sticky position to prevent jump
      const shouldBeSticky = sidebarRect.top <= stickyTop;
      
      // Get RTL-aware start position
      const currentStart = isRTL ? window.innerWidth - containerRect.right : containerRect.left;
      
      if (shouldBeSticky && !isSticky) {
        // Just became sticky - use container position for accuracy
        // This ensures we get the correct position after language/direction changes
        initialStart = currentStart;
        initialWidth = containerRect.width;
        initialTop = sidebarRect.top;
        isSticky = true;
        
        // Use current top position to prevent jump, will be corrected on next frame
        setSidebarStyle({
          position: 'fixed',
          top: `${initialTop}px`,
          [direction]: `${initialStart}px`,
          width: `${initialWidth}px`,
          zIndex: 10
        });
        
        // Immediately correct to target position on next frame for smooth transition
        requestAnimationFrame(() => {
          setSidebarStyle({
            position: 'fixed',
            top: `${stickyTop}px`,
            [direction]: `${initialStart}px`,
            width: `${initialWidth}px`,
            zIndex: 10
          });
        });
      } else if (shouldBeSticky && isSticky) {
        // Already sticky - update position if container moved (e.g., on resize or language change)
        const currentWidth = containerRect.width;
        
        // Always update if position/width changed significantly (e.g., window resize or language change)
        if (Math.abs(currentStart - initialStart) > 1 || Math.abs(currentWidth - initialWidth) > 1) {
          initialStart = currentStart;
          initialWidth = currentWidth;
          setSidebarStyle({
            position: 'fixed',
            top: `${stickyTop}px`,
            [direction]: `${initialStart}px`,
            width: `${initialWidth}px`,
            zIndex: 10
          });
        }
      } else if (!shouldBeSticky && isSticky) {
        // No longer sticky - return to normal flow
        // Only switch back if we're well above the sticky position to prevent rapid toggling
        if (sidebarRect.top > stickyTop + 10) {
          isSticky = false;
          setSidebarStyle({
            position: 'relative',
            top: 'auto',
            [direction]: 'auto',
            width: 'auto',
            zIndex: 'auto'
          });
        }
      }
    };
    
    // Initial check
    handleScroll();
    
    // When language changes, reset and recalculate after layout updates
    const languageChanged = prevLanguageRef.current !== i18n.language;
    if (languageChanged) {
      prevLanguageRef.current = i18n.language;
      // Reset sticky state and initial values to force recalculation
      isSticky = false;
      initialStart = 0;
      initialWidth = 0;
      initialTop = 0;
      setSidebarStyle({});
      // Trigger resize event after a short delay to ensure layout has updated
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 100);
    }
    
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll, { passive: true });
    
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, [activeSection, i18n.language, isRTL]);

  // Reset sticky header when section changes
  useEffect(() => {
    setShowStickyHeader(false);
    setStickyH2Info(null);
  }, [activeSection]);

  // Handle sticky header visibility on scroll
  useEffect(() => {
    const handleScroll = () => {
      if (!contentHeaderRef.current) return;
      
      const headerRect = contentHeaderRef.current.getBoundingClientRect();
      // Show sticky header when the original header is scrolled past the top (accounting for main header)
      setShowStickyHeader(headerRect.top < 64);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Check initial state
    return () => window.removeEventListener('scroll', handleScroll);
  }, [activeSection]);

  const sections = [
    {
      id: 'about',
      title: t('about.about'),
      icon: Info,
      content: markdownContent.about,
      activeClasses: 'bg-blue-50 border-2 border-blue-200 text-blue-700 font-medium',
      iconActiveClasses: 'text-blue-600',
      iconInactiveClasses: 'text-gray-500',
      headerIconClasses: 'text-blue-600'
    },
    {
      id: 'terms',
      title: t('about.termsConditions'),
      icon: FileText,
      content: markdownContent.terms,
      activeClasses: 'bg-slate-50 border-2 border-slate-300 text-slate-800 font-medium',
      iconActiveClasses: 'text-slate-700',
      iconInactiveClasses: 'text-gray-500',
      headerIconClasses: 'text-slate-700'
    },
    {
      id: 'privacy',
      title: t('about.privacyPolicy'),
      icon: Shield,
      content: markdownContent.privacy,
      activeClasses: 'bg-green-50 border-2 border-green-200 text-green-700 font-medium',
      iconActiveClasses: 'text-green-600',
      iconInactiveClasses: 'text-gray-500',
      headerIconClasses: 'text-green-600'
    },
    {
      id: 'accessibility',
      title: t('about.accessibilityPolicy'),
      icon: Accessibility,
      content: markdownContent.accessibility,
      activeClasses: 'bg-purple-50 border-2 border-purple-200 text-purple-700 font-medium',
      iconActiveClasses: 'text-purple-600',
      iconInactiveClasses: 'text-gray-500',
      headerIconClasses: 'text-purple-600'
    }
  ];

  const activeSectionData = sections.find(s => s.id === activeSection) || sections[0];

  return (
    <>
      <TopNavigationBar variant="light" showBackground={true} mode="full" />
      <div className="bg-gradient-to-b from-gray-50 to-white pt-[4rem]" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="container mx-auto px-4 pt-6 pb-4 max-w-6xl">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 items-start" style={{ overflow: 'visible' }}>
            {/* Sidebar Navigation */}
            <aside ref={sidebarContainerRef} className="lg:col-span-1" style={{ alignSelf: 'start', height: 'fit-content' }}>
              <nav 
                ref={sidebarRef}
                className="space-y-2" 
                style={sidebarStyle}
                data-sidebar-sticky
                dir={isRTL ? 'rtl' : 'ltr'}
              >
                {sections.map((section) => {
                  const Icon = section.icon;
                  const isActive = activeSection === section.id;
                  return (
                    <LongPressHoverButton
                      key={section.id}
                      onClick={() => setActiveSection(section.id)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 text-left ${
                        isActive
                          ? section.activeClasses
                          : 'bg-white border-2 border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                      title={section.title}
                      aria-label={section.title}
                    >
                      <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? section.iconActiveClasses : section.iconInactiveClasses}`} />
                      <span className="text-sm">{section.title}</span>
                    </LongPressHoverButton>
                  );
                })}
                
                {/* Feedback Button */}
                <button
                  onClick={() => setShowFeedbackModal(true)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 text-left bg-white border-2 border-gray-200 text-gray-700 hover:border-primary-300 hover:bg-primary-50 mt-4"
                  title={t('about.sendFeedback')}
                  aria-label={t('about.sendFeedback')}
                >
                  <MessageSquare className="w-5 h-5 flex-shrink-0 text-gray-500" />
                  <span className="text-sm">{t('about.sendFeedback')}</span>
                </button>
              </nav>
            </aside>

            {/* Main Content */}
            <motion.div
              key={activeSection}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4 }}
              className="lg:col-span-3"
            >
              <div 
                ref={(el) => {
                  if (el) sectionRefs.current[activeSection] = el;
                }}
                data-content-box
                className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 md:p-10 relative overflow-visible"
              >
                {/* Sticky Header */}
                {showStickyHeader && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="sticky top-16 z-40 bg-white border-b border-gray-200 shadow-sm py-4 -mt-8 md:-mt-10 mb-6 -mx-8 md:-mx-10 px-8 md:px-10"
                  >
                    <div className="flex items-center gap-3 max-w-full">
                      <activeSectionData.icon className={`w-5 h-5 flex-shrink-0 ${activeSectionData.headerIconClasses}`} />
                      <h2 className="text-xl font-semibold text-gray-900 truncate">
                        {activeSectionData.title}
                      </h2>
                    </div>
                    {stickyH2Info && stickyH2Info.text && (
                      <div className="mt-2">
                        <h3 className="text-lg font-semibold text-gray-900 truncate">
                          {stickyH2Info.text}
                        </h3>
                      </div>
                    )}
                  </motion.div>
                )}
                <div 
                  ref={contentHeaderRef}
                  className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-200"
                >
                  <activeSectionData.icon className={`w-6 h-6 ${activeSectionData.headerIconClasses}`} />
                  <h2 className="text-3xl font-semibold text-gray-900">
                    {activeSectionData.title}
                  </h2>
                </div>
                <MarkdownSection 
                  content={activeSectionData.content} 
                  title={activeSectionData.title}
                  navigate={navigate}
                  onStickyH2Change={setStickyH2Info}
                  t={t}
                  isRTL={isRTL}
                />
              </div>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Feedback Modal */}
      <FeedbackFormModal
        isOpen={showFeedbackModal}
        onClose={() => setShowFeedbackModal(false)}
        feedback={null}
      />
    </>
  );
}


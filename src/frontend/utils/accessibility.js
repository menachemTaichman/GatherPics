/**
 * Generate accessible alt text for images
 * @param {Object} options - Alt text generation options
 * @param {number} options.photoIndex - Zero-based index of the photo
 * @param {string} options.contextType - Type of context (Person, Moment, Album, Upload, etc.)
 * @param {string|null} options.contextLabel - Label for the context (e.g., person name, album name)
 * @param {string|null} options.description - Optional image description
 * @returns {string|null} Generated alt text or null if insufficient data
 */
export function generateImageAltText({ photoIndex, contextType, contextLabel = null, description = null }) {
  if (photoIndex === null || photoIndex === undefined || !contextType) {
    return null;
  }
  
  const contextPart = contextLabel ? `${contextType} ${contextLabel}` : contextType;
  const baseText = `Photo #${photoIndex + 1} in ${contextPart}`;
  
  if (description?.trim()) {
    return `${baseText}: ${description.trim()}`;
  }
  
  return baseText;
}


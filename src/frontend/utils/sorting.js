/**
 * Global sorting utilities for the face recognition application
 */

import { getImageCount } from './settings';

/**
 * Sort images by various criteria
 * @param {Array} images - Array of image objects
 * @param {string} sortBy - 'date' or 'name'
 * @param {string} sortOrder - 'asc' or 'desc'
 * @returns {Array} Sorted images array
 */
export const sortImages = (images, sortBy = 'date', sortOrder = 'asc') => {
  if (!images || !images.length) return [];
  
  return [...images].sort((a, b) => {
    let comparison = 0;
    
    if (sortBy === 'date') {
      const dateA = a.date_taken ? new Date(a.date_taken).getTime() : 0;
      const dateB = b.date_taken ? new Date(b.date_taken).getTime() : 0;
      comparison = dateA - dateB;
    } else if (sortBy === 'name') {
      comparison = (a.id || a.label || '').localeCompare(b.id || b.label || '');
    }
    
    return sortOrder === 'asc' ? comparison : -comparison;
  });
};

/**
 * Sort images with complex date handling (prioritizes images with dates)
 * @param {Array} images - Array of image objects
 * @param {string} sortOrder - 'asc' or 'desc'
 * @returns {Array} Sorted images array
 */
export const sortImagesWithDatePriority = (images, sortOrder = 'asc') => {
  if (!images || !images.length) return [];
  
  return [...images].sort((a, b) => {
    const hasDateA = !!a.date_taken;
    const hasDateB = !!b.date_taken;
    
    // If both have dates, sort by date
    if (hasDateA && hasDateB) {
      const dateA = new Date(a.date_taken);
      const dateB = new Date(b.date_taken);
      return sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
    }
    
    // If only one has a date, prioritize the one with date
    if (hasDateA && !hasDateB) return sortOrder === 'asc' ? -1 : 1;
    if (!hasDateA && hasDateB) return sortOrder === 'asc' ? 1 : -1;
    
    // If neither has a date, sort by filename
    return sortOrder === 'asc' 
      ? (a.label || '').localeCompare(b.label || '') 
      : (b.label || '').localeCompare(a.label || '');
  });
};

/**
 * Sort face groups by various criteria
 * @param {Array} groups - Array of group objects
 * @param {string} sortBy - 'name', 'count', or 'date'
 * @param {string} sortOrder - 'asc' or 'desc'
 * @returns {Array} Sorted groups array
 */
export const sortGroups = (groups, sortBy = 'name', sortOrder = 'asc') => {
  if (!groups || !groups.length) return [];
  
  return [...groups].sort((a, b) => {
    let comparison = 0;
    
    switch (sortBy) {
      case 'name':
        comparison = (a.label || '').localeCompare(b.label || '');
        break;
      case 'count':
        comparison = getImageCount(a) - getImageCount(b);
        break;
      case 'date':
        comparison = new Date(a.updated_at || 0) - new Date(b.updated_at || 0);
        break;
      default:
        comparison = 0;
    }
    
    return sortOrder === 'asc' ? comparison : -comparison;
  });
};

/**
 * Sort moments by start datetime
 * @param {Array} moments - Array of moment objects
 * @param {string} sortOrder - 'asc' or 'desc'
 * @returns {Array} Sorted moments array
 */
export const sortMoments = (moments, sortOrder = 'asc') => {
  if (!moments || !moments.length) return [];
  
  return [...moments].sort((a, b) => {
    // Handle moments without start field
    if (!a.start_date && !b.start_date) return 0;
    if (!a.start_date) return 1;
    if (!b.start_date) return -1;

    const comparison = new Date(a.start_date) - new Date(b.start_date);
    return sortOrder === 'asc' ? comparison : -comparison;
  });
};

/**
 * Generic sort function for any array with custom field mapping
 * @param {Array} items - Array to sort
 * @param {string} field - Field name to sort by
 * @param {string} sortOrder - 'asc' or 'desc'
 * @param {Function} fieldMapper - Function to extract sort value from item
 * @returns {Array} Sorted array
 */
export const sortByField = (items, field, sortOrder = 'asc', fieldMapper = null) => {
  if (!items || !items.length) return [];
  
  return [...items].sort((a, b) => {
    let valueA, valueB;
    
    if (fieldMapper) {
      valueA = fieldMapper(a);
      valueB = fieldMapper(b);
    } else {
      valueA = a[field];
      valueB = b[field];
    }
    
    let comparison = 0;
    
    // Handle different data types
    if (typeof valueA === 'string' && typeof valueB === 'string') {
      comparison = valueA.localeCompare(valueB);
    } else if (valueA instanceof Date && valueB instanceof Date) {
      comparison = valueA.getTime() - valueB.getTime();
    } else if (typeof valueA === 'number' && typeof valueB === 'number') {
      comparison = valueA - valueB;
    } else {
      // Fallback to string comparison
      comparison = String(valueA || '').localeCompare(String(valueB || ''));
    }
    
    return sortOrder === 'asc' ? comparison : -comparison;
  });
};

/**
 * Toggle sort order between 'asc' and 'desc'
 * @param {string} currentOrder - Current sort order
 * @returns {string} Toggled sort order
 */
export const toggleSortOrder = (currentOrder) => {
  return currentOrder === 'asc' ? 'desc' : 'asc';
};

/**
 * Get sort icon based on sort order
 * @param {string} sortOrder - 'asc' or 'desc'
 * @returns {string} Icon name for the sort order
 */
export const getSortIcon = (sortOrder) => {
  return sortOrder === 'asc' ? 'ArrowUp' : 'ArrowDown';
};

/**
 * Sort uploads by various criteria
 * @param {Array} uploads - Array of upload objects
 * @param {string} sortBy - 'started_at', 'profile_label', 'images_count', or 'status'
 * @param {string} sortOrder - 'asc' or 'desc'
 * @returns {Array} Sorted uploads array
 */
export const sortUploads = (uploads, sortBy = 'started_at', sortOrder = 'desc') => {
  if (!uploads || !uploads.length) return [];
  
  return [...uploads].sort((a, b) => {
    let comparison = 0;
    
    switch (sortBy) {
      case 'started_at':
      case 'completed_at':
        comparison = new Date(a[sortBy] || 0) - new Date(b[sortBy] || 0);
        break;
      case 'profile_label':
        comparison = (a.profile_label || '').localeCompare(b.profile_label || '');
        break;
      case 'images_count':
      case 'faces_count':
      case 'clusters_count':
      case 'moments_count':
        comparison = (a[sortBy] || 0) - (b[sortBy] || 0);
        break;
      case 'status':
        comparison = (a.status || '').localeCompare(b.status || '');
        break;
      default:
        comparison = 0;
    }
    
    return sortOrder === 'asc' ? comparison : -comparison;
  });
}; 

/**
 * Filter images by group membership
 * @param {Array} images - Array of image objects
 * @param {Array} selectedGroups - Array of group IDs to filter by
 * @param {string} mode - 'and' or 'or'
 * @param {boolean} only - If true, only show images that belong exclusively to selected groups
 * @returns {Array} Filtered images array
 */
export const filterImages = (images, selectedGroups, mode = 'and', only = false) => {
  if (!images || !images.length) return images;
  if (!selectedGroups || selectedGroups.length === 0) return images;

  const selected = (selectedGroups || []).map((g) => String(g));
  return images.filter((img) => {
    const groups = Array.from(img.groups || new Set()).map((g) => String(g));

    // First check if image belongs to any/all of the selected groups
    let belongsToSelected = false;
    if (mode === 'and') belongsToSelected = selected.every((g) => groups.includes(g));
    else if (mode === 'or') belongsToSelected = selected.some((g) => groups.includes(g));

    if (!belongsToSelected) return false;

    // If "only" mode is enabled, ensure image has no groups outside the selected list
    if (only && groups.some((g) => !selected.includes(g))) return false;

    return true;
  });
};




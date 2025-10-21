import { ImageComponent } from '../../hooks/useImage.jsx';

/**
 * A reusable thumbnail component with a centered remove button on hover
 * 
 * @param {Object} props
 * @param {string} props.imageUrl - The URL of the image to display
 * @param {string} [props.alt] - Alt text for the image
 * @param {Function} props.onRemove - Callback when remove is clicked
 * @param {string} [props.text] - Optional text to overlay on the image (e.g., album name)
 * @param {'small' | 'medium' | 'large'} [props.size='medium'] - Size variant
 * @param {boolean} [props.withGradient=false] - Whether to show gradient background (for albums)
 * @param {string} [props.imageClassName] - Additional classes for the image
 * @param {string} [props.iconType] - Icon type for ImageComponent
 * @param {string} [props.title] - Tooltip title
 * @returns {JSX.Element}
 */
export default function RemovableThumbnail({
  imageUrl,
  alt = '',
  onRemove,
  text = null,
  size = 'medium',
  withGradient = false,
  imageClassName = '',
  iconType = 'image',
  title = 'Click to remove'
}) {
  // Size variants
  const sizeClasses = {
    tiny: 'w-7 h-7',
    small: 'w-12 h-12',
    medium: 'w-full aspect-square',
    large: 'w-full aspect-square'
  };

  // Background gradient (for albums)
  const backgroundClass = withGradient
    ? 'bg-gradient-to-br from-blue-50 to-purple-50'
    : 'bg-gray-100';

  // Image opacity based on whether text is shown
  const defaultImageClass = text 
    ? 'w-full h-full object-cover opacity-20 group-hover:opacity-10 transition-opacity'
    : 'w-full h-full object-cover group-hover:opacity-50 transition-opacity';

  const finalImageClass = imageClassName || defaultImageClass;

  // Ensure imageUrl is a string or null, handle function case
  const resolvedImageUrl = typeof imageUrl === 'function' ? imageUrl() : imageUrl;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      className={`group relative ${sizeClasses[size]} rounded-lg overflow-hidden ${backgroundClass} border border-gray-200 hover:border-red-400 transition-all cursor-pointer`}
      title={title}
    >
      {/* Image */}
      {ImageComponent(resolvedImageUrl || '', {
        className: finalImageClass,
        alt: alt,
        iconType: iconType
      })}

      {/* Optional text overlay (for albums) */}
      {text && (
        <div className="absolute inset-0 flex items-center justify-center p-2 group-hover:opacity-30 transition-opacity">
          <p className="text-gray-800 font-semibold text-sm text-center leading-snug line-clamp-3">
            {text}
          </p>
        </div>
      )}

      {/* Centered X icon on hover */}
      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="w-6 h-6 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-md transition-colors">
          <span className="text-lg leading-none mb-0.5">×</span>
        </div>
      </div>
    </button>
  );
}





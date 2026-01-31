import React from 'react';
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { useRTL } from '../../hooks/useRTL';

/**
 * ScrollableTable - A reusable table component with sticky header and scrollable body
 * 
 * @param {Object} props
 * @param {Array} props.columns - Column definitions (supports hideOnMobile property)
 * @param {Array} props.data - Row data array
 * @param {string} props.sortBy - Current sort field
 * @param {string} props.sortDir - Sort direction: 'asc' | 'desc'
 * @param {Function} props.onSort - Sort handler: (field) => void
 * @param {ReactNode|Object} props.emptyState - Empty state element or { icon, title, message }
 * @param {string} props.className - Additional CSS classes
 * @param {Function} props.getRowKey - Function to get unique key for row: (row, index) => string
 * @param {string} props.rowClassName - Additional CSS classes for rows
 * @param {Function} props.onRowClick - Row click handler: (row, index) => void
 */
export default function ScrollableTable({
  columns,
  data,
  sortBy,
  sortDir,
  onSort,
  emptyState = null,
  className = '',
  getRowKey = (row, index) => row.id || row.key || `row-${index}`,
  rowClassName = '',
  onRowClick = null,
  style = {},
}) {
  const { isRTL } = useRTL();
  const getSortIcon = (field) => {
    if (!field || sortBy !== field) return null;
    return sortDir === 'asc' ? (
      <ArrowUp className="w-3 h-3 sm:w-4 sm:h-4" />
    ) : (
      <ArrowDown className="w-3 h-3 sm:w-4 sm:h-4" />
    );
  };

  const handleSort = (field) => {
    if (field && onSort) {
      onSort(field);
    }
  };

  // Get RTL-aware text alignment class using logical properties
  // Use text-start/text-end which automatically respect dir attribute
  const getAlignClass = (align) => {
    if (align === 'center') return 'text-center';
    if (align === 'right') return 'text-end';
    return 'text-start'; // 'left' or default
  };

  // Get RTL-aware flex justify class using logical properties
  // justify-start and justify-end automatically respect dir attribute
  const getJustifyClass = (align) => {
    if (align === 'center') return 'justify-center';
    if (align === 'right') return 'justify-end';
    return 'justify-start'; // 'left' or default
  };

  if (data.length === 0 && emptyState) {
    if (typeof emptyState === 'object' && emptyState !== null && !React.isValidElement(emptyState)) {
      const { icon: EmptyIcon, title, message } = emptyState;
      return (
        <div className={`h-full flex items-center justify-center ${className}`}>
          <div className="text-center">
            {EmptyIcon && <EmptyIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />}
            {title && <h3 className="text-lg font-medium text-gray-900 mb-2">{title}</h3>}
            {message && <p className="text-gray-500">{message}</p>}
          </div>
        </div>
      );
    }
    return <div className={`h-full flex items-center justify-center ${className}`}>{emptyState}</div>;
  }

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className={`bg-white rounded-lg shadow-sm border border-gray-200 w-full mb-1 flex flex-col ${className}`} style={{ maxHeight: 'calc(100%)', ...style }}>
      <OverlayScrollbarsComponent
        element="div"
        className="flex-1 min-h-0"
        options={{
          scrollbars: {
            theme: isRTL ? 'os-theme-dark os-theme-dark-rtl' : 'os-theme-dark',
            autoHide: 'never',
            autoHideDelay: 0,
            clickScroll: true,
            dragScroll: true,
            pointers: ['mouse', 'touch', 'pen'],
            visibility: 'visible',
            size: '10px',
          },
          overflow: {
            x: 'scroll',
            y: 'scroll',
          },
        }}
        style={{ touchAction: 'pan-y pan-x' }}
      >
        <table dir={isRTL ? 'rtl' : 'ltr'} className="w-full border-collapse min-w-full">
          <thead className="bg-white sticky top-0 z-20 shadow-sm">
            <tr className="border-b border-gray-200">
              {columns.map((column, colIndex) => {
                const {
                  key,
                  label,
                  sortable = false,
                  align = 'left',
                  renderHeader,
                  className: colClassName = '',
                  headerClassName = '',
                  hideOnMobile = false,
                } = column;

                const isSortable = sortable && onSort;
                const alignClass = getAlignClass(align);
                const mobileHideClass = hideOnMobile ? 'hidden sm:table-cell' : '';

                if (renderHeader) {
                  return (
                    <th
                      key={key || colIndex}
                      dir={isRTL ? 'rtl' : 'ltr'}
                      className={`sticky top-0 z-20 bg-white px-2 py-2 sm:px-4 sm:py-3 text-[10px] sm:text-xs font-medium text-gray-600 uppercase tracking-wider border-b border-gray-200 ${alignClass} ${isSortable ? 'cursor-pointer hover:bg-gray-50' : ''} ${mobileHideClass} ${headerClassName} ${colClassName}`}
                      onClick={() => isSortable && handleSort(key)}
                    >
                      {renderHeader(column, getSortIcon(key), sortBy === key)}
                    </th>
                  );
                }

                return (
                  <th
                    key={key || colIndex}
                    dir={isRTL ? 'rtl' : 'ltr'}
                    className={`sticky top-0 z-20 bg-white px-2 py-2 sm:px-4 sm:py-3 text-[10px] sm:text-xs font-medium text-gray-600 uppercase tracking-wider border-b border-gray-200 ${alignClass} ${isSortable ? 'cursor-pointer hover:bg-gray-50' : ''} ${mobileHideClass} ${headerClassName} ${colClassName}`}
                    onClick={() => isSortable && handleSort(key)}
                  >
                    {isSortable ? (
                      <div dir={isRTL ? 'rtl' : 'ltr'} className={`flex items-center ${getJustifyClass(align)} gap-0.5 sm:gap-1`}>
                        <span className="truncate">{label}</span>
                        {getSortIcon(key)}
                      </div>
                    ) : (
                      <span className="truncate">{label}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {data.map((row, rowIndex) => (
              <tr
                key={getRowKey(row, rowIndex)}
                className={`hover:bg-gray-50 ${onRowClick ? 'cursor-pointer' : ''} ${rowClassName}`}
                onClick={() => onRowClick && onRowClick(row, rowIndex)}
              >
                {columns.map((column, colIndex) => {
                  const {
                    key,
                    renderCell,
                    align = 'left',
                    className: colClassName = '',
                    cellClassName = '',
                    hideOnMobile = false,
                  } = column;

                  const alignClass = getAlignClass(align);
                  const mobileHideClass = hideOnMobile ? 'hidden sm:table-cell' : '';

                  const cellContent = renderCell ? renderCell(row, rowIndex) : row[key] ?? '';
                  const isPlainText = !renderCell && typeof cellContent === 'string';

                  return (
                    <td
                      key={key || colIndex}
                      dir={isRTL ? 'rtl' : 'ltr'}
                      className={`px-2 py-2 sm:px-4 sm:py-3 text-xs sm:text-sm ${alignClass} ${mobileHideClass} ${cellClassName} ${colClassName}`}
                    >
                      {isPlainText ? (
                        <div className="truncate max-w-[200px] sm:max-w-none" title={cellContent}>
                          {cellContent}
                        </div>
                      ) : (
                        cellContent
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </OverlayScrollbarsComponent>
    </div>
  );
}


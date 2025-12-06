import React from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { useRTL } from '../../hooks/useRTL';

/**
 * ScrollableTable - A reusable table component with sticky header and scrollable body
 * 
 * @param {Object} props
 * @param {Array} props.columns - Column definitions
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
      <ArrowUp className="w-4 h-4" />
    ) : (
      <ArrowDown className="w-4 h-4" />
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
      <div className="overflow-y-auto flex-1 min-h-0">
        <table dir={isRTL ? 'rtl' : 'ltr'} className="w-full border-collapse">
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
                } = column;

                const isSortable = sortable && onSort;
                const alignClass = getAlignClass(align);

                if (renderHeader) {
                  return (
                    <th
                      key={key || colIndex}
                      dir={isRTL ? 'rtl' : 'ltr'}
                      className={`sticky top-0 z-20 bg-white px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wider border-b border-gray-200 ${alignClass} ${isSortable ? 'cursor-pointer hover:bg-gray-50' : ''} ${headerClassName} ${colClassName}`}
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
                    className={`sticky top-0 z-20 bg-white px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wider border-b border-gray-200 ${alignClass} ${isSortable ? 'cursor-pointer hover:bg-gray-50' : ''} ${headerClassName} ${colClassName}`}
                    onClick={() => isSortable && handleSort(key)}
                  >
                    {isSortable ? (
                      <div dir={isRTL ? 'rtl' : 'ltr'} className={`flex items-center ${getJustifyClass(align)} gap-1`}>
                        <span>{label}</span>
                        {getSortIcon(key)}
                      </div>
                    ) : (
                      label
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
                  } = column;

                  const alignClass = getAlignClass(align);

                  return (
                    <td
                      key={key || colIndex}
                      dir={isRTL ? 'rtl' : 'ltr'}
                      className={`px-4 py-3 text-sm ${alignClass} ${cellClassName} ${colClassName}`}
                    >
                      {renderCell ? renderCell(row, rowIndex) : row[key] ?? ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


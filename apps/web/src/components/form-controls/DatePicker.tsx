import { useState, useRef, useEffect, forwardRef, useCallback } from 'react';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DatePickerProps {
  /** Selected date value (single mode) */
  value?: Date | null;
  /** Selected date range (range mode) */
  rangeValue?: { start: Date | null; end: Date | null };
  /** Callback when date changes (single mode) */
  onChange?: (date: Date | null) => void;
  /** Callback when date range changes (range mode) */
  onRangeChange?: (range: { start: Date | null; end: Date | null }) => void;
  /** Enable date range selection */
  range?: boolean;
  /** Minimum selectable date */
  minDate?: Date;
  /** Maximum selectable date */
  maxDate?: Date;
  /** Label for the date picker */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Error message */
  error?: string;
  /** Date display format */
  format?: 'short' | 'medium' | 'long';
  /** Allow clearing the selection */
  clearable?: boolean;
  /** Disabled state */
  disabled?: boolean;
  /** Name for form integration */
  name?: string;
  /** Wrapper class */
  wrapperClassName?: string;
  /** Custom class */
  className?: string;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const formatDate = (date: Date | null, format: 'short' | 'medium' | 'long' = 'medium'): string => {
  if (!date) return '';

  const optionsMap: Record<string, Intl.DateTimeFormatOptions> = {
    short: { month: 'numeric', day: 'numeric', year: '2-digit' },
    medium: { month: 'short', day: 'numeric', year: 'numeric' },
    long: { month: 'long', day: 'numeric', year: 'numeric' },
  };

  return new Intl.DateTimeFormat('en-US', optionsMap[format]).format(date);
};

const isSameDay = (date1: Date, date2: Date): boolean => {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
};

const isDateInRange = (date: Date, start: Date | null, end: Date | null): boolean => {
  if (!start || !end) return false;
  return date >= start && date <= end;
};

const getDaysInMonth = (year: number, month: number): Date[] => {
  const days: Date[] = [];
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  // Add padding days from previous month
  const startPadding = firstDay.getDay();
  for (let i = startPadding - 1; i >= 0; i--) {
    const date = new Date(year, month, -i);
    days.push(date);
  }

  // Add days of current month
  for (let i = 1; i <= lastDay.getDate(); i++) {
    days.push(new Date(year, month, i));
  }

  // Add padding days from next month
  const endPadding = 42 - days.length; // 6 rows * 7 days
  for (let i = 1; i <= endPadding; i++) {
    days.push(new Date(year, month + 1, i));
  }

  return days;
};

export const DatePicker = forwardRef<HTMLButtonElement, DatePickerProps>(
  (
    {
      value,
      rangeValue,
      onChange,
      onRangeChange,
      range = false,
      minDate,
      maxDate,
      label,
      placeholder = 'Select date',
      error,
      format = 'medium',
      clearable = true,
      disabled = false,
      name,
      wrapperClassName,
      className,
    },
    ref
  ) => {
    const [isOpen, setIsOpen] = useState(false);
    const [currentMonth, setCurrentMonth] = useState(() => {
      if (value) return new Date(value.getFullYear(), value.getMonth(), 1);
      if (rangeValue?.start)
        return new Date(rangeValue.start.getFullYear(), rangeValue.start.getMonth(), 1);
      return new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    });
    const [hoverDate, setHoverDate] = useState<Date | null>(null);
    const [selectingEnd, setSelectingEnd] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const hasError = !!error;

    const displayValue = range
      ? rangeValue?.start && rangeValue?.end
        ? `${formatDate(rangeValue.start, format)} - ${formatDate(rangeValue.end, format)}`
        : rangeValue?.start
          ? `${formatDate(rangeValue.start, format)} - ...`
          : ''
      : formatDate(value || null, format);

    const days = getDaysInMonth(currentMonth.getFullYear(), currentMonth.getMonth());

    const isDateDisabled = useCallback(
      (date: Date): boolean => {
        if (minDate && date < new Date(minDate.setHours(0, 0, 0, 0))) return true;
        if (maxDate && date > new Date(maxDate.setHours(23, 59, 59, 999))) return true;
        return false;
      },
      [minDate, maxDate]
    );

    const handleDateClick = useCallback(
      (date: Date) => {
        if (isDateDisabled(date)) return;

        if (range) {
          if (!selectingEnd || !rangeValue?.start) {
            onRangeChange?.({ start: date, end: null });
            setSelectingEnd(true);
          } else {
            if (date < rangeValue.start) {
              onRangeChange?.({ start: date, end: rangeValue.start });
            } else {
              onRangeChange?.({ start: rangeValue.start, end: date });
            }
            setSelectingEnd(false);
            setIsOpen(false);
          }
        } else {
          onChange?.(date);
          setIsOpen(false);
        }
      },
      [range, selectingEnd, rangeValue, onChange, onRangeChange, isDateDisabled]
    );

    const handleClear = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        if (range) {
          onRangeChange?.({ start: null, end: null });
          setSelectingEnd(false);
        } else {
          onChange?.(null);
        }
      },
      [range, onChange, onRangeChange]
    );

    const goToPrevMonth = () => {
      setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
    };

    const goToNextMonth = () => {
      setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
    };

    const goToToday = () => {
      const today = new Date();
      setCurrentMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    };

    // Close on outside click
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
          setIsOpen(false);
        }
      };

      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Handle keyboard navigation
    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    return (
      <div className={cn('w-full', wrapperClassName)} ref={containerRef}>
        {label && (
          <label
            className={cn(
              'block text-sm font-medium mb-1.5',
              hasError ? 'text-danger-700' : 'text-secondary-700',
              disabled && 'text-secondary-400'
            )}
          >
            {label}
          </label>
        )}

        <div className="relative">
          <button
            ref={ref}
            type="button"
            name={name}
            disabled={disabled}
            onClick={() => !disabled && setIsOpen(!isOpen)}
            onKeyDown={handleKeyDown}
            className={cn(
              'w-full flex items-center justify-between rounded-lg border px-3 py-2 text-sm text-left transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-offset-0',
              !hasError &&
                !disabled && [
                  'border-secondary-300 bg-white',
                  'hover:border-secondary-400',
                  'focus:border-primary-500 focus:ring-primary-500/20',
                ],
              hasError && [
                'border-danger-500 bg-white',
                'focus:border-danger-500 focus:ring-danger-500/20',
              ],
              disabled && [
                'bg-secondary-100 border-secondary-200',
                'text-secondary-400 cursor-not-allowed',
              ],
              className
            )}
          >
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-secondary-400" />
              <span className={cn(!displayValue && 'text-secondary-400')}>
                {displayValue || placeholder}
              </span>
            </div>

            {clearable && displayValue && !disabled && (
              <span
                role="button"
                tabIndex={-1}
                onClick={handleClear}
                className="p-0.5 rounded hover:bg-secondary-100 text-secondary-400 hover:text-secondary-600"
              >
                <X className="h-4 w-4" />
              </span>
            )}
          </button>

          {isOpen && (
            <div className="absolute z-50 mt-1 bg-white border border-secondary-200 rounded-lg shadow-lg p-3 animate-fade-in">
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <button
                  type="button"
                  onClick={goToPrevMonth}
                  className="p-1 rounded hover:bg-secondary-100 text-secondary-600"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>

                <div className="flex items-center gap-2">
                  <span className="font-medium text-secondary-900">
                    {MONTHS[currentMonth.getMonth()]} {currentMonth.getFullYear()}
                  </span>
                  <button
                    type="button"
                    onClick={goToToday}
                    className="text-xs text-primary-600 hover:text-primary-700 hover:underline"
                  >
                    Today
                  </button>
                </div>

                <button
                  type="button"
                  onClick={goToNextMonth}
                  className="p-1 rounded hover:bg-secondary-100 text-secondary-600"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>

              {/* Day headers */}
              <div className="grid grid-cols-7 gap-1 mb-1">
                {DAYS.map(day => (
                  <div
                    key={day}
                    className="text-xs font-medium text-secondary-500 text-center py-1"
                  >
                    {day}
                  </div>
                ))}
              </div>

              {/* Days grid */}
              <div className="grid grid-cols-7 gap-1">
                {days.map(date => {
                  const isCurrentMonth = date.getMonth() === currentMonth.getMonth();
                  const isToday = isSameDay(date, new Date());
                  const isSelected = value ? isSameDay(date, value) : false;
                  const isRangeStart = rangeValue?.start
                    ? isSameDay(date, rangeValue.start)
                    : false;
                  const isRangeEnd = rangeValue?.end ? isSameDay(date, rangeValue.end) : false;
                  const isInRange =
                    range &&
                    isDateInRange(date, rangeValue?.start || null, rangeValue?.end || null);
                  const isInHoverRange =
                    range &&
                    selectingEnd &&
                    rangeValue?.start &&
                    hoverDate &&
                    isDateInRange(
                      date,
                      rangeValue.start < hoverDate ? rangeValue.start : hoverDate,
                      rangeValue.start > hoverDate ? rangeValue.start : hoverDate
                    );
                  const isDisabled = isDateDisabled(date);

                  return (
                    <button
                      // ENG-172 — date-derived key (not the array index) so
                      // React keeps each calendar cell stable across month
                      // navigation and future range-decoration re-renders.
                      key={`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`}
                      type="button"
                      disabled={isDisabled}
                      onClick={() => handleDateClick(date)}
                      onMouseEnter={() => range && setHoverDate(date)}
                      onMouseLeave={() => range && setHoverDate(null)}
                      className={cn(
                        'h-8 w-8 text-sm rounded-md transition-colors',
                        !isCurrentMonth && 'text-secondary-300',
                        isCurrentMonth &&
                          !isSelected &&
                          !isRangeStart &&
                          !isRangeEnd &&
                          'text-secondary-700',
                        isCurrentMonth &&
                          !isSelected &&
                          !isRangeStart &&
                          !isRangeEnd &&
                          !isDisabled &&
                          'hover:bg-secondary-100',
                        isToday &&
                          !isSelected &&
                          !isRangeStart &&
                          !isRangeEnd &&
                          'border border-primary-500',
                        (isSelected || isRangeStart || isRangeEnd) && 'bg-primary-600 text-white',
                        (isInRange || isInHoverRange) &&
                          !isRangeStart &&
                          !isRangeEnd &&
                          'bg-primary-100',
                        isDisabled && 'text-secondary-300 cursor-not-allowed hover:bg-transparent'
                      )}
                    >
                      {date.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {error && <p className="mt-1.5 text-sm text-danger-600">{error}</p>}
      </div>
    );
  }
);

DatePicker.displayName = 'DatePicker';

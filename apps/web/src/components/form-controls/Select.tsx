import { useState, useRef, useEffect, forwardRef, type ReactNode, useCallback } from 'react';
import { ChevronDown, Check, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  /** Options to display */
  options: SelectOption[];
  /** Currently selected value */
  value?: string | number | null;
  /** Callback when selection changes */
  onChange?: (value: string | number | null) => void;
  /** Placeholder text when no selection */
  placeholder?: string;
  /** Label for the select */
  label?: string;
  /** Error message */
  error?: string;
  /** Enable search/filter functionality */
  searchable?: boolean;
  /** Allow clearing the selection */
  clearable?: boolean;
  /** Disabled state */
  disabled?: boolean;
  /** Name for form integration */
  name?: string;
  /** Custom class for the select button */
  className?: string;
  /** Wrapper class */
  wrapperClassName?: string;
  /** Custom render for options */
  renderOption?: (option: SelectOption) => ReactNode;
  /** Custom class for the trigger label text */
  triggerLabelClassName?: string;
}

export const Select = forwardRef<HTMLButtonElement, SelectProps>(
  (
    {
      options,
      value,
      onChange,
      placeholder = 'Select an option...',
      label,
      error,
      searchable = false,
      clearable = false,
      disabled = false,
      name,
      className,
      wrapperClassName,
      renderOption,
      triggerLabelClassName,
    },
    ref
  ) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLUListElement>(null);

    const selectedOption = options.find(opt => opt.value === value);
    const hasError = !!error;

    const filteredOptions = searchTerm
      ? options.filter(opt => opt.label.toLowerCase().includes(searchTerm.toLowerCase()))
      : options;

    const handleSelect = useCallback(
      (option: SelectOption) => {
        if (option.disabled) return;
        onChange?.(option.value);
        setIsOpen(false);
        setSearchTerm('');
        setHighlightedIndex(0);
      },
      [onChange]
    );

    const handleClear = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        onChange?.(null);
      },
      [onChange]
    );

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (disabled) return;

        switch (e.key) {
          case 'Enter':
          case ' ':
            e.preventDefault();
            if (isOpen && filteredOptions[highlightedIndex]) {
              handleSelect(filteredOptions[highlightedIndex]);
            } else {
              setHighlightedIndex(0);
              setIsOpen(true);
            }
            break;
          case 'Escape':
            setIsOpen(false);
            setSearchTerm('');
            setHighlightedIndex(0);
            break;
          case 'ArrowDown':
            e.preventDefault();
            if (!isOpen) {
              setHighlightedIndex(0);
              setIsOpen(true);
            } else {
              setHighlightedIndex(prev => (prev < filteredOptions.length - 1 ? prev + 1 : prev));
            }
            break;
          case 'ArrowUp':
            e.preventDefault();
            if (isOpen) {
              setHighlightedIndex(prev => (prev > 0 ? prev - 1 : prev));
            }
            break;
        }
      },
      [disabled, isOpen, filteredOptions, highlightedIndex, handleSelect]
    );

    // Close on outside click
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
          setIsOpen(false);
          setSearchTerm('');
          setHighlightedIndex(0);
        }
      };

      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Focus search input when opened
    useEffect(() => {
      if (isOpen && searchable && searchInputRef.current) {
        searchInputRef.current.focus();
      }
    }, [isOpen, searchable]);

    // Scroll highlighted option into view
    useEffect(() => {
      if (isOpen && listRef.current) {
        const highlightedEl = listRef.current.children[highlightedIndex] as HTMLElement;
        if (highlightedEl) {
          highlightedEl.scrollIntoView({ block: 'nearest' });
        }
      }
    }, [highlightedIndex, isOpen]);

    return (
      <div className={cn('w-full', wrapperClassName)} ref={containerRef}>
        {label && (
          <label
            className={cn(
              'label mb-2',
              hasError && 'text-danger-700',
              disabled && 'text-secondary-500'
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
              'select-trigger flex items-center justify-between gap-2 text-left',
              hasError && 'border-danger-400 ring-danger-100/60',
              disabled && 'cursor-not-allowed',
              className
            )}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
          >
            <span
              className={cn('min-w-0 flex-1 truncate', !selectedOption && 'text-secondary-400', triggerLabelClassName)}
              title={selectedOption?.label ?? placeholder}
            >
              {selectedOption?.label || placeholder}
            </span>

            <div className="flex shrink-0 items-center gap-1">
              {clearable && selectedOption && !disabled && (
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={handleClear}
                  className="rounded-full p-0.5 text-secondary-400 transition-colors hover:bg-secondary-100 hover:text-secondary-700"
                >
                  <X className="h-4 w-4" />
                </span>
              )}
              <ChevronDown
                className={cn(
                  'h-4 w-4 text-secondary-400 transition-transform',
                  isOpen && 'rotate-180'
                )}
              />
            </div>
          </button>

          {isOpen && (
            <div className="absolute z-50 mt-2 w-full animate-pop-in overflow-hidden rounded-[24px] border border-line/80 bg-card/98 p-2 shadow-[var(--shadow-panel)] backdrop-blur-xl">
              {searchable && (
                <div className="border-b border-line/70 px-1 pb-3 pt-1">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary-400" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchTerm}
                      onChange={e => {
                        setSearchTerm(e.target.value);
                        setHighlightedIndex(0);
                      }}
                      placeholder="Search..."
                      className="input h-10 pl-9"
                    />
                  </div>
                </div>
              )}

              <ul ref={listRef} role="listbox" className="scrollbar-thin max-h-64 overflow-auto py-1.5">
                {filteredOptions.length === 0 ? (
                  <li className="px-3 py-4 text-center text-sm text-secondary-500">
                    No options found
                  </li>
                ) : (
                  filteredOptions.map((option, index) => (
                    <li
                      key={option.value}
                      role="option"
                      aria-selected={option.value === value}
                      onClick={() => handleSelect(option)}
                      className={cn(
                        'flex cursor-pointer items-center justify-between rounded-2xl px-3 py-2.5 text-sm transition-colors',
                        option.value === value && 'bg-primary-50 text-primary-700',
                        option.value !== value && index === highlightedIndex && 'bg-secondary-100/90',
                        option.value !== value &&
                          index !== highlightedIndex &&
                          'hover:bg-secondary-100/70',
                        option.disabled && 'cursor-not-allowed text-secondary-400'
                      )}
                    >
                      {renderOption ? renderOption(option) : option.label}
                      {option.value === value && <Check className="h-4 w-4 text-primary-600" />}
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
        </div>

        {error && <p className="mt-2 text-sm text-danger-600">{error}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';

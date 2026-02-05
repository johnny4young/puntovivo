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
              setIsOpen(true);
            }
            break;
          case 'Escape':
            setIsOpen(false);
            setSearchTerm('');
            break;
          case 'ArrowDown':
            e.preventDefault();
            if (!isOpen) {
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

    // Reset highlighted index when search changes
    useEffect(() => {
      // Reset index when search term changes to show first result
      if (searchTerm !== '') {
        setHighlightedIndex(0);
      }
    }, [searchTerm]);

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
            aria-haspopup="listbox"
            aria-expanded={isOpen}
          >
            <span className={cn(!selectedOption && 'text-secondary-400')}>
              {selectedOption?.label || placeholder}
            </span>

            <div className="flex items-center gap-1">
              {clearable && selectedOption && !disabled && (
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={handleClear}
                  className="p-0.5 rounded hover:bg-secondary-100 text-secondary-400 hover:text-secondary-600"
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
            <div className="absolute z-50 w-full mt-1 bg-white border border-secondary-200 rounded-lg shadow-lg animate-fade-in">
              {searchable && (
                <div className="p-2 border-b border-secondary-100">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      placeholder="Search..."
                      className="w-full pl-8 pr-3 py-1.5 text-sm border border-secondary-200 rounded-md focus:outline-none focus:border-primary-500"
                    />
                  </div>
                </div>
              )}

              <ul ref={listRef} role="listbox" className="max-h-60 overflow-auto py-1">
                {filteredOptions.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-secondary-500 text-center">
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
                        'flex items-center justify-between px-3 py-2 text-sm cursor-pointer',
                        option.value === value && 'bg-primary-50 text-primary-700',
                        option.value !== value && index === highlightedIndex && 'bg-secondary-100',
                        option.value !== value &&
                          index !== highlightedIndex &&
                          'hover:bg-secondary-50',
                        option.disabled && 'text-secondary-400 cursor-not-allowed'
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

        {error && <p className="mt-1.5 text-sm text-danger-600">{error}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';

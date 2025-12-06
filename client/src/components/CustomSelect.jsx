import React, { useState, useEffect, useRef } from 'react';
import './CustomSelect.css';

// 递归查找选中项的辅助函数
const findOptionById = (options, id) => {
  for (const option of options) {
    if (option.id === id) return option;
    if (option.children) {
      const found = findOptionById(option.children, id);
      if (found) return found;
    }
  }
  return null;
};

const CustomSelect = ({ options, value, onChange, placeholder = '请选择' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef(null);

  const selectedOption = findOptionById(options, value);

  // 处理点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [wrapperRef]);

  const handleOptionClick = (option) => {
    onChange(option.id);
    setIsOpen(false);
  };

  // 递归渲染选项
  const renderOptions = (opts, level = 0) => {
    return opts.map(opt => (
      <React.Fragment key={opt.id}>
        <div
          className={`custom-option ${opt.id === value ? 'selected' : ''}`}
          style={{ paddingLeft: `${12 + level * 20}px` }} // 20px per level for indentation
          onClick={() => handleOptionClick(opt)}
        >
          {opt.displayName || opt.name} 
        </div>
        {/* 虽然当前设计是扁平的，但保留此结构以支持未来可能的子选项展开 */}
        {opt.children && isOpen && renderOptions(opt.children, level + 1)}
      </React.Fragment>
    ));
  };

  return (
    <div className="custom-select-wrapper" ref={wrapperRef}>
      <div className="custom-select__trigger" onClick={() => setIsOpen(!isOpen)}>
        <span className="custom-select__value">
          {selectedOption ? (selectedOption.displayName || selectedOption.name) : placeholder}
        </span>
        <span className={`custom-select__arrow ${isOpen ? 'open' : ''}`}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
          </svg>
        </span>
      </div>
      {isOpen && (
        <div className="custom-select__options">
          {renderOptions(options)}
        </div>
      )}
    </div>
  );
};

export default CustomSelect;

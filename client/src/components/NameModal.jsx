import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

const NameModal = ({ isOpen, onClose, onConfirm, title, placeholder, initialValue = '' }) => {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue, isOpen]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (value.trim()) {
      onConfirm(value.trim());
      setValue('');
    }
  };

  const handleCancel = () => {
    setValue('');
    onClose();
  };

  if (!isOpen) return null;

  const modalElement = (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{title}</h3>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="modal-input"
            autoFocus
          />
          <div className="modal-actions">
            <button
              type="button"
              onClick={handleCancel}
              className="modal-button secondary"
            >
              取消
            </button>
            <button
              type="submit"
              className="modal-button primary"
              disabled={!value.trim()}
            >
              确认
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  // 使用 Portal 将模态框渲染到 document.body，避免被父容器的层叠上下文影响
  return createPortal(modalElement, document.body);
};

export default NameModal;
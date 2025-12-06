import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

const InputModal = ({ isOpen, onClose, onSubmit, title, placeholder }) => {
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    if (isOpen) {
      setInputValue('');
    }
  }, [isOpen]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (inputValue.trim()) {
      onSubmit(inputValue.trim());
    }
  };

  if (!isOpen) return null;

  const modalElement = (
    <div className="modal-overlay" onClick={onClose}>
      <div className="input-modal" onClick={e => e.stopPropagation()}>
        <h3 className="input-modal-title">{title}</h3>
        <form onSubmit={handleSubmit}>
          <input 
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            className="form-input"
            placeholder={placeholder}
            autoFocus
          />
          <div className="input-modal-actions">
            <button type="button" className="btn btn--secondary" onClick={onClose}>取消</button>
            <button type="submit" className="btn btn--primary">确定</button>
          </div>
        </form>
      </div>
    </div>
  );

  // 使用 Portal 将模态框渲染到 document.body，避免被父容器的层叠上下文影响
  return createPortal(modalElement, document.body);
};

export default InputModal;

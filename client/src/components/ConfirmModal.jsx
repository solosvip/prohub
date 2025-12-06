import React from 'react';
import { createPortal } from 'react-dom';

const ConfirmModal = ({ 
  isOpen, 
  onClose, 
  onConfirm, 
  title = '确认操作', 
  message, 
  confirmText = '确认', 
  cancelText = '取消',
  type = 'warning', // 'warning', 'danger', 'info', 'success'
  showCancel = true,
  showConfirm = true,
}) => {
  if (!isOpen) return null;

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  const getTypeStyles = () => {
    switch (type) {
      case 'danger':
        return {
          iconColor: '#ef4444',
          confirmBg: '#ef4444',
          confirmHover: '#dc2626'
        };
      case 'warning':
        return {
          iconColor: '#f59e0b',
          confirmBg: '#f59e0b',
          confirmHover: '#d97706'
        };
      case 'success':
        return {
          iconColor: '#10b981',
          confirmBg: '#10b981',
          confirmHover: '#059669'
        };
      default:
        return {
          iconColor: '#3b82f6',
          confirmBg: '#3b82f6',
          confirmHover: '#2563eb'
        };
    }
  };

  const typeStyles = getTypeStyles();

  const modalElement = (
    <div className="modal-overlay" onClick={onClose}>
      <div className="confirm-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-modal-header">
          <div className="confirm-modal-icon" style={{ color: typeStyles.iconColor }}>
            {type === 'danger' && (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            )}
            {type === 'warning' && (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            )}
            {type === 'info' && (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </div>
          <h3 className="confirm-modal-title">{title}</h3>
        </div>
        <div className="confirm-modal-body">
          <p className="confirm-modal-message">{message}</p>
        </div>
        <div className="confirm-modal-actions">
          {showCancel && (
            <button
              type="button"
              onClick={onClose}
              className="confirm-modal-button secondary"
            >
              {cancelText}
            </button>
          )}
          {showConfirm && (
            <button
              type="button"
              onClick={handleConfirm}
              className="confirm-modal-button primary"
              style={{ 
                backgroundColor: typeStyles.confirmBg,
                ':hover': { backgroundColor: typeStyles.confirmHover }
              }}
            >
              {confirmText}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modalElement, document.body);
};

export default ConfirmModal;

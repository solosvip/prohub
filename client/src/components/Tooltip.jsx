import React from 'react'

// Lightweight tooltip; pure CSS hover reveal.
// Usage:
//   <Tooltip text="复制"><button>...</button></Tooltip>
// Optional placement: top | bottom | left | right (default: top)
const Tooltip = ({ text, placement = 'top', children, wrapperClassName = '' }) => {
  if (!text) return children;
  return (
    <span className={`tooltip-wrapper tooltip-${placement} ${wrapperClassName}`}>
      {children}
      <span className='tooltip-bubble'>
        {text}
        <span className='tooltip-arrow'></span>
      </span>
    </span>
  );
};

export default Tooltip;

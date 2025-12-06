import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import './SegmentedPrompt.css';

const SegmentedPrompt = React.memo(({ segments, onChange }) => {
  const [expanded, setExpanded] = useState(false); // 展开/收起 文本域模式
  const rootRef = useRef(null);
  // 在本地维护一份副本，减少父组件渲染频率对输入体验的影响
  const [localSegs, setLocalSegs] = useState(() => Array.isArray(segments) ? segments : []);
  const flushTimer = useRef(null);
  // 用 ref 持有最近一次的本地值，避免闭包拿到旧值
  const localRef = useRef(localSegs);
  localRef.current = localSegs;

  // 当外部 segments prop 变化时，同步到本地 state
  useEffect(() => {
    if (Array.isArray(segments)) {
      setLocalSegs(segments);
    }
  }, [segments]);

  const flushUpstream = (immediate = false) => {
    if (immediate) {
      clearTimeout(flushTimer.current);
      onChange?.(localRef.current);
      return;
    }
    clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => onChange?.(localRef.current), 200);
  };

  // 修改段内容/标题
  const handleSegmentChange = (index, field, value) => {
    if (localRef.current[index] && localRef.current[index][field] === value) {
      return; // 值未发生变化
    }
    setLocalSegs(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
    flushUpstream(false);
  };

  // 新增一段
  const handleAddSegment = () => {
    setLocalSegs(prev => [...prev, { title: '', content: '' }]);
    flushUpstream(true);
  };

  // 删除一段
  const handleDeleteSegment = (index) => {
    setLocalSegs(prev => prev.filter((_, i) => i !== index));
    flushUpstream(true);
  };

  // 自适应高度（仅在展开模式生效）
  const autoResize = (ta) => {
    if (!ta) return;
    if (!expanded) { ta.style.height = ''; ta.style.overflowY = ''; ta.style.resize = ''; return; }
    ta.style.height = 'auto';
    ta.style.overflowY = 'hidden';
    ta.style.resize = 'none';
    ta.style.height = `${ta.scrollHeight}px`;
  };

  const resizeAll = () => {
    if (!rootRef.current) return;
    const list = rootRef.current.querySelectorAll('textarea.segment-content-textarea');
    list.forEach((ta) => autoResize(ta));
  };

  useEffect(() => {
    // 切换展开/收起，或段数量变化时统一调整高度
    resizeAll();
    if (!expanded) return;
    const h = () => resizeAll();
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, [expanded, segments.length]);

  // 立即调整单个 textarea 高度（展开模式下在 onChange 中调用）
  const autoResizeImmediate = (el) => {
    if (!el) return;
    
    // 保存当前页面滚动位置
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;
    
    // 临时保存当前高度
    const currentHeight = el.style.height;
    
    // 重置高度以获取准确的 scrollHeight
    el.style.height = 'auto';
    const newHeight = el.scrollHeight;
    
    // 立即设置新高度
    el.style.height = `${newHeight}px`;
    
    // 强制恢复滚动位置
    window.scrollTo(0, scrollY);
  };

  // 上下移动一段
  const handleMoveSegment = (index, direction) => {
    if ((direction === -1 && index === 0) || (direction === 1 && index === localRef.current.length - 1)) {
      return;
    }
    const newSegments = [...localRef.current];
    const [moved] = newSegments.splice(index, 1);
    newSegments.splice(index + direction, 0, moved);
    setLocalSegs(newSegments);
    flushUpstream(true);
  };

  // 复制帮助：优先 Clipboard API，回退到 execCommand
  const copyToClipboard = async (text) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text || '');
      } else {
        const ta = document.createElement('textarea');
        ta.value = text || '';
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.left = '-1000px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      try { toast.success('已复制'); } catch (_) {}
    } catch (e) {
      try { toast.error('复制失败'); } catch (_) {}
      console.error('Copy failed', e);
    }
  };

  return (
    <div className="segmented-prompt-container" ref={rootRef}>
      <div className="segmented-header">
        <label className="form-label" style={{ marginBottom: 0 }}>字段分段 / 内容</label>
        <button
          type="button"
          className="segments-toggle-btn"
          onClick={() => setExpanded(v => !v)}
          title={expanded ? '收起全段' : '展开全段'}
        >
          {expanded ? (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 3a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5A.75.75 0 0110 3z" clipRule="evenodd"/></svg>
              收起全段
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 17a.75.75 0 01-.75-.75v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5a.75.75 0 011.5 0v4.5h4.5a.75.75 0 010 1.5h-4.5v-4.5A.75.75 0 0110 17z" clipRule="evenodd"/></svg>
              展开全段
            </>
          )}
        </button>
      </div>
      <div className="segments-list">
        {localSegs.map((segment, index) => (
          <div key={`segment-${index}`} className="segment-item">
            <div className="segment-header">
              <span className="segment-number">{index + 1}</span>
              <input
                type="text"
                className="segment-title-input"
                placeholder={`段 ${index + 1} 标题 (可选)`}
                value={segment.title}
                onChange={(e) => handleSegmentChange(index, 'title', e.target.value)}
              />
              <div className="segment-actions">
                <button
                  type="button"
                  className="segment-action-btn"
                  onClick={() => copyToClipboard(segment.content)}
                  title="复制"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                    <path fillRule="evenodd" d="M7.502 6h7.128A3.375 3.375 0 0 1 18 9.375v9.375a3 3 0 0 0 3-3V6.108c0-1.505-1.125-2.811-2.664-2.94a48.972 48.972 0 0 0-.673-.05A3 3 0 0 0 15 1.5h-1.5a3 3 0 0 0-2.663 1.618c-.225.015-.45.032-.673.05C8.662 3.295 7.554 4.542 7.502 6ZM13.5 3A1.5 1.5 0 0 0 12 4.5h4.5A1.5 1.5 0 0 0 15 3h-1.5Z" clipRule="evenodd" />
                    <path fillRule="evenodd" d="M3 9.375C3 8.339 3.84 7.5 4.875 7.5h9.75c1.036 0 1.875.84 1.875 1.875v11.25c0 1.035-.84 1.875-1.875 1.875h-9.75A1.875 1.875 0 0 1 3 20.625V9.375ZM6 12a.75.75 0 0 1 .75-.75h.008a.75.75 0 0 1 .75.75v.008a.75.75 0 0 1-.75.75H6.75a.75.75 0 0 1-.75-.75V12Zm2.25 0a.75.75 0 0 1 .75-.75h3.75a.75.75 0 0 1 0 1.5H9a.75.75 0 0 1-.75-.75ZM6 15a.75.75 0 0 1 .75-.75h.008a.75.75 0 0 1 .75.75v.008a.75.75 0 0 1-.75.75H6.75a.75.75 0 0 1-.75-.75V15Zm2.25 0a.75.75 0 0 1 .75-.75h3.75a.75.75 0 0 1 0 1.5H9a.75.75 0 0 1-.75-.75ZM6 18a.75.75 0 0 1 .75-.75h.008a.75.75 0 0 1 .75.75v.008a.75.75 0 0 1-.75.75H6.75a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
                  </svg>
                </button>
                <button 
                  type="button" 
                  className="segment-action-btn" 
                  onClick={() => handleMoveSegment(index, -1)} 
                  disabled={index === 0}
                  title="上移"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 17a.75.75 0 01-.75-.75V5.612L6.22 8.72a.75.75 0 01-1.06-1.06l4.25-4.25a.75.75 0 011.06 0l4.25 4.25a.75.75 0 01-1.06 1.06L10.75 5.612V16.25a.75.75 0 01-.75.75z" clipRule="evenodd" /></svg>
                </button>
                <button 
                  type="button" 
                  className="segment-action-btn" 
                  onClick={() => handleMoveSegment(index, 1)} 
                  disabled={index === localSegs.length - 1}
                  title="下移"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 3a.75.75 0 01.75.75v10.638l3.03-3.03a.75.75 0 011.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0l-4.25-4.25a.75.75 0 111.06-1.06l3.03 3.03V3.75A.75.75 0 0110 3z" clipRule="evenodd" /></svg>
                </button>
                <button 
                  type="button" 
                  className="segment-action-btn delete" 
                  onClick={() => handleDeleteSegment(index)}
                  title="删除"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.58.22-2.365.468a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193v-.443A2.75 2.75 0 0011.25 1h-2.5zM10 4.875c0-.621.504-1.125 1.125-1.125h.008c.621 0 1.125.504 1.125 1.125v.113c-1.536.21-3.068.524-4.552.957v-.113C8.375 5.375 8.879 4.875 9.5 4.875h.5zM7.596 17.5a1.25 1.25 0 01-1.24-1.136L5.29 5.922a42.052 42.052 0 011.36-1.418l.84 10.512a.75.75 0 00.742.683h4.518a.75.75 0 00.742-.683l.84-10.512a42.052 42.052 0 011.36 1.418l-1.06 10.444a1.25 1.25 0 01-1.24 1.136H7.596z" clipRule="evenodd" /></svg>
                </button>
              </div>
            </div>
            <textarea
              className="segment-content-textarea"
              placeholder="请输入提示词内容..."
              value={segment.content}
              onChange={(e) => {
                const el = e.target;
                handleSegmentChange(index, 'content', el.value);
                if (expanded) autoResizeImmediate(el);
              }}
              rows={4}
              onBlur={() => flushUpstream(true)}
              ref={(el) => { 
                if (!el) return; 
                // 展开模式：由 JS 控制高度并关闭拖拽；收起模式：恢复浏览器默认
                if (expanded) { 
                  el.style.overflowY='hidden'; 
                  el.style.resize='none'; 
                } else { 
                  el.style.overflowY=''; 
                  el.style.resize='vertical'; 
                  el.style.height=''; 
                } 
              }}
            />
          </div>
        ))}
      </div>
      <button type="button" className="btn-add-segment" onClick={handleAddSegment}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" /></svg>
        新增一段
      </button>
    </div>
  );
});

SegmentedPrompt.displayName = 'SegmentedPrompt';

export default SegmentedPrompt;

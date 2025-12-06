import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { useDropzone } from 'react-dropzone';
import api from '../services/api';
import SegmentedPrompt from './SegmentedPrompt';
import CustomSelect from './CustomSelect';
import ConfirmModal from './ConfirmModal';
import { toast } from 'react-toastify';
import './CreationView.css';
import ShareModal from './ShareModal';

const CreationView = ({ onCancel, item = null, mode = 'create', defaultFolderId = null, defaultType = 'text', onCreated }) => {
  // [TEST] instrumentation: render counter to detect unexpected parent re-renders
  //       Remove when finished testing the scroll-jump issue.
  // eslint-disable-next-line no-console
  const queryClient = useQueryClient();

  const [creationType, setCreationType] = useState(mode === 'create' ? defaultType : 'text');

  const [formData, setFormData] = useState({
    title: '',
    segments: [{ title: '', content: '' }],
    folder_id: '',
    tag_ids: [],
    is_favorite: false,
  });

  // Multi image support: unified order list for existing & pending
  const [uiOrder, setUiOrder] = useState([]); // [{ kind: 'existing'|'pending', id?, tempId?, file?, previewUrl?, path?, thumb? }]
  const [previewIndex, setPreviewIndex] = useState(null); // 当前放大预览的图片索引（仅图片模式使用）
  const [isUploading, setIsUploading] = useState(false);
  const [isSorting, setIsSorting] = useState(false);
  const [draggingIndex, setDraggingIndex] = useState(null);

  // Video single-file state (create only or preview on edit)
  const [videoFile, setVideoFile] = useState(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState('');
  const [videoTempId, setVideoTempId] = useState('');
  const [serverItem, setServerItem] = useState(item);
  const [errors, setErrors] = useState({});
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [tagQuery, setTagQuery] = useState('');
  const [smartTagSuggestions, setSmartTagSuggestions] = useState([]);
  const [tagInputFocused, setTagInputFocused] = useState(false);
  const [localCreatedTags, setLocalCreatedTags] = useState({}); // {id: {id,name,color}}

  const { data: foldersData } = useQuery('folders', () => api.getFolders(), { staleTime: 300000 });
  const { data: tagsData } = useQuery('tags', () => api.getTags(), { staleTime: 300000 });

  // Keep SegmentedPrompt controlled: update segments into form state
  // Use useCallback to maintain stable reference and prevent unnecessary re-renders
  const onSegmentsChange = useCallback((segments) => {
    // segments is an array like [{ title, content }, ...]
    if (Array.isArray(segments)) {
      // [TEST] instrumentation: log upstream calls frequency and payload size
      //       Helps confirm debounced updates from SegmentedPrompt.
      // eslint-disable-next-line no-console
      setFormData(prev => ({ ...prev, segments }));
    }
  }, []);

  const folderOptions = useMemo(() => {
    if (!foldersData?.data) return [];
    const optionsTree = foldersData.data.filter(folder => folder.type === creationType);
    const processFolders = (folders) => folders.map(folder => ({
      ...folder,
      displayName: folder.name,
      children: folder.children ? processFolders(folder.children) : []
    }));
    return processFolders(optionsTree);
  }, [foldersData, creationType]);

  useEffect(() => {
    const loadItemData = (itemToLoad) => {
      let initialType = defaultType;
      if (mode === 'edit' && itemToLoad) {
        const isEditImage = itemToLoad.content_type?.startsWith('image');
        const isEditVideo = itemToLoad.content_type?.startsWith('video');
        initialType = isEditImage ? 'image' : isEditVideo ? 'video' : 'text';
      }
      setCreationType(initialType);

      let initialSegments = [{ title: '', content: '' }];
      if (mode === 'edit' && itemToLoad?.content) {
        try {
          const parsedSegments = JSON.parse(itemToLoad.content);
          if (Array.isArray(parsedSegments) && parsedSegments.length > 0) {
            initialSegments = parsedSegments;
          }
        } catch (e) {
          initialSegments = [{ title: '原始内容', content: itemToLoad.content }];
        }
      }

      const initialTagIds = itemToLoad?.tags?.map(tag => tag.id) || [];
      const cappedTagIds = (initialType === 'image' || initialType === 'video') ? initialTagIds.slice(0, 4) : initialTagIds;
      setFormData({
        title: itemToLoad?.title || '',
        segments: initialSegments,
        folder_id: itemToLoad?.folder_id || defaultFolderId || '',
        tag_ids: cappedTagIds,
        is_favorite: itemToLoad?.is_favorite || false
      });

      if (initialType === 'video') {
        try { if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl); } catch(e){}
        setVideoFile(null);
        setVideoTempId('');
        setVideoPreviewUrl('');
      }
    };

    if (mode === 'edit' && item?.id) {
      api.getItem(item.id).then(resp => {
        const freshItem = resp?.data;
        if (freshItem) {
          loadItemData(freshItem);
          setServerItem(freshItem);
        }
      }).catch(err => {
        console.error("Failed to fetch latest item data:", err);
        loadItemData(item);
      });
    } else {
      loadItemData(item);
    }
  }, [mode, item?.id, defaultFolderId, defaultType]);

  // Track server item updates (after replace/delete)
  useEffect(() => { setServerItem(item); }, [item?.id, item?.file_path, item?.thumbnail_path]);

  // Enforce max 4 tags when switching type to image/video (cap existing selections)
  useEffect(() => {
    const isMedia = creationType === 'image' || creationType === 'video';
    if (isMedia && (formData.tag_ids || []).length > 4) {
      setFormData(prev => ({ ...prev, tag_ids: (prev.tag_ids || []).slice(0, 4) }));
      // 本地化提示：图片/视频最多选择 4 个标签
      try { toast.info('图片/视频最多选择 4 个标签'); } catch(_){}
    }
  }, [creationType]);

  // 智能标签：仅在标签输入框获得焦点时计算一次（基于当前标题与分段内容）
  const fetchSmartTagSuggestions = async () => {
    try {
      const title = (formData.title || '').trim();
      const content = JSON.stringify(formData.segments || []);
      const r = await api.getTagsByText({ title, content });
      // 后端已按出现次数降序返回；最多 6 条（后端已限制，前端再兜底一次）
      const arr = Array.isArray(r?.data) ? r.data.slice(0, 6) : [];
      setSmartTagSuggestions(arr);
    } catch (e) {
      setSmartTagSuggestions([]);
    }
  };
  // 取消基于输入的请求/过滤：标题与正文变化时不触发；输入时也不触发

  // Load existing medias for edit/image
  useEffect(() => {
    if (mode === 'edit' && item && creationType === 'image') {
      (async () => {
        try {
          const resp = await api.getItem(item.id);
          const medias = resp?.data?.medias || [];
          const ordered = medias.sort((a,b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
          const mapped = ordered.map(m => ({ kind:'existing', id: m.id, path: m.file_path, thumb: m.thumbnail_path }));
          setUiOrder(mapped);
        } catch (e) { console.error('Load medias failed:', e); }
      })();
    }
  }, [mode, item, creationType]);

  // 当图片列表变化时，确保预览索引始终有效；若列表为空则关闭预览
  useEffect(() => {
    setPreviewIndex(prev => {
      if (!uiOrder || uiOrder.length === 0) return null;
      if (typeof prev === 'number' && prev >= uiOrder.length) return uiOrder.length - 1;
      return prev;
    });
  }, [uiOrder]);

    const renderFolderSelector = () => (
    <CustomSelect
      options={folderOptions}
      value={formData.folder_id}
      onChange={(val) => setFormData(prev => ({ ...prev, folder_id: val }))}
      // 占位文案：改为中文，保持其余交互与样式不变
      placeholder='请选择文件夹…'
    />
  );

  const renderTagSelector = () => (
    <div className='form-group'>
      <label className='form-label'>标签</label>
      <div className='tag-input-container'>
        <input
          type='text'
          placeholder='输入名称，回车增加标签'
          className='form-input'
          value={tagQuery}
          onChange={(e) => setTagQuery(e.target.value)}
          onFocus={() => {
            // 仅在聚焦时触发一次智能推荐（无论输入框是否为空）
            setTagInputFocused(true);
            fetchSmartTagSuggestions();
          }}
          onBlur={() => { setTagInputFocused(false); }}
          onKeyDown={async (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              const q = (tagQuery || '').trim();
              if (!q) return;
              const isMedia = creationType === 'image' || creationType === 'video';
              const maxReached = isMedia && (formData.tag_ids.length >= 4);
              if (maxReached) { toast.info('图片/视频最多选择 4 个标签'); return; }
              const exists = ([...(tagsData?.data || []), ...Object.values(localCreatedTags)]).find(t => (t.name || '').toLowerCase() === q.toLowerCase());
              if (exists) {
                if (!formData.tag_ids.includes(exists.id)) {
                  setFormData(prev => ({ ...prev, tag_ids: [...prev.tag_ids, exists.id] }));
                }
                setLocalCreatedTags(prev => ({ ...prev, [exists.id]: exists }));
                setTagQuery('');
                return;
              }
              try {
                const r = await api.createTag({ name: q });
                const newTag = r?.data;
                if (newTag?.id) {
                  setFormData(prev => ({ ...prev, tag_ids: [...prev.tag_ids, newTag.id] }));
                  setLocalCreatedTags(prev => ({ ...prev, [newTag.id]: newTag }));
                  queryClient.invalidateQueries('tags');
                  setTagQuery('');
                }
              } catch (err) { console.error('Create tag failed', err); }
            }
          }}
          disabled={isUploading}
        />
        <div className='selected-tags'>
          {(() => {
            const all = [...(tagsData?.data || []), ...Object.values(localCreatedTags)];
            const map = new Map(all.map(t => [t.id, t]));
            return (formData.tag_ids || []).map(id => map.get(id)).filter(Boolean).map(tag => (
              <div key={tag.id} className='selected-tag'>
                <span className='tag-color' style={{ backgroundColor: tag.color }}></span>
                {tag.name}
                <button type='button' className='tag-remove' onClick={() => setFormData(prev => ({ ...prev, tag_ids: prev.tag_ids.filter(x => x !== tag.id) }))} disabled={isUploading}>&times;</button>
              </div>
            ));
          })()}
        </div>
        <div className='tag-suggestions'>
          {(() => {
            if (!tagInputFocused) return null;
            const q = (tagQuery || '').trim().toLowerCase();
            const already = new Set(formData.tag_ids || []);
            const all = [...(tagsData?.data || []), ...Object.values(localCreatedTags)];

            // 仅当用户输入了内容时，尝试在“已有标签”中寻找最优匹配
            let bestMatch = null;
            if (q) {
              let bestScore = -1;
              for (const t of all) {
                const name = String(t?.name || '').toLowerCase();
                if (!name) continue;
                let score = -1;
                if (name === q) score = 3; // 完全相同
                else if (name.startsWith(q)) score = 2; // 以输入开头
                else if (name.includes(q) || q.includes(name)) score = 1; // 包含（双向）
                if (score > bestScore) { bestScore = score; bestMatch = t; }
                else if (score === bestScore && score > -1) {
                  const a = (bestMatch?.usage_count ?? -1);
                  const b = (t?.usage_count ?? -1);
                  if (b > a || (b === a && String(t.name||'').localeCompare(String(bestMatch?.name||'')) < 0)) {
                    bestMatch = t;
                  }
                }
              }
              if (bestScore < 0) bestMatch = null;
              // 若已选中，则不算命中
              if (bestMatch && already.has(bestMatch.id)) bestMatch = null;
            }

            // 智能推荐去重（若有 bestMatch，则从推荐里排除）
            const smartList = (smartTagSuggestions || []).filter(t => t && (!bestMatch || t.id !== bestMatch.id) && !already.has(t.id));

            // 没有任何可展示的：不显示
            if (!bestMatch && smartList.length === 0) return null;

            return (
              <div className='suggestions' onMouseDown={(e)=>{ /* 阻止输入框失焦，确保按钮 onClick 能触发 */ e.preventDefault(); }}>
                {/* 命中已有：与标签在同一行展示 */}
                {bestMatch ? (
                  <>
                    <span className='suggestions-title'>已有：</span>
                    <button
                      key={'best-' + bestMatch.id}
                      type='button'
                      className='tag-suggestion'
                      onClick={() => { setFormData(prev => ({ ...prev, tag_ids: [...prev.tag_ids, bestMatch.id] })); setTagQuery(''); }}
                      disabled={isUploading}
                      title='匹配的已有标签'
                    >
                      <span className='tag-color' style={{ backgroundColor: bestMatch.color }}></span>
                      {bestMatch.name}
                      <span className='tag-add'>+</span>
                    </button>
                    {/* 若后面还有推荐项，额外加一点水平间距 */}
                    {smartList.length > 0 && (<span style={{ width:8 }}></span>)}
                  </>
                ) : null}

                {/* 智能推荐：与“推荐：”同一行展示 */}
                {smartList.length > 0 ? (
                  <>
                    <span className='suggestions-title'>推荐：</span>
                    {smartList.map(t => {
                      const disabled = already.has(t.id) || isUploading;
                      return (
                        <button
                          key={t.id}
                          type='button'
                          className='tag-suggestion'
                          onClick={() => { if (!already.has(t.id)) setFormData(prev => ({ ...prev, tag_ids: [...prev.tag_ids, t.id] })); setTagQuery(''); }}
                          disabled={disabled}
                          title='智能推荐'
                        >
                          <span className='tag-color' style={{ backgroundColor: t.color }}></span>
                          {t.name}
                          <span className='tag-add'>+</span>
                        </button>
                      );
                    })}
                  </>
                ) : null}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );

  const onInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  // 把“新增图片”的核心逻辑抽成函数，onDrop 与粘贴都可复用
  const handleAddImages = async (incomingFiles = []) => {
    if (!incomingFiles || incomingFiles.length === 0) return;
    const MAX_COUNT = 20;
    const MAX_SIZE_IMG = 10 * 1024 * 1024;
    let list = [...uiOrder];
    const space = MAX_COUNT - list.length;
    const valid = [];
    const errorsList = [];
    for (const f of incomingFiles) {
      if (!f) continue;
      if (f.size > MAX_SIZE_IMG) { errorsList.push('图片 ' + f.name + ' 大于 10MB，已跳过'); } else { valid.push(f); }
    }
    const sliced = valid.slice(0, Math.max(0, space));
    const overflow = valid.length - sliced.length;
    if (overflow > 0) errorsList.push('已达到最多 20 张，额外 ' + overflow + ' 张已忽略');
    if (errorsList.length) setErrors(prev => ({ ...prev, upload: errorsList.join(', ') })); else if (errors.upload) setErrors(prev => ({ ...prev, upload: '' }));
    if (sliced.length === 0) return;
    try {
      const resp = await api.uploadPreviewImages(sliced);
      const arr = resp?.data || [];
      const toAdd = arr.map((it, idx) => ({ kind: 'pending', tempId: it.id, file: sliced[idx], previewUrl: it.url }));
      list = list.concat(toAdd);
      setUiOrder(list);
    } catch (e) { setErrors(prev => ({ ...prev, upload: '上传失败' })); }
  };

  // Use a compact upload UX: button-triggered file dialog; still accept drops on the thumbnail grid
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    multiple: creationType === 'image',
    accept: creationType === 'image' ? { 'image/*': [] } : (creationType === 'video' ? { 'video/*': [] } : undefined),
    noClick: true,
    noKeyboard: true,
    onDrop: async (acceptedFiles, _rejects) => {
      if (isSorting) return;
      if (!acceptedFiles || acceptedFiles.length === 0) return;

      if (creationType === 'video') {
        const f = acceptedFiles[0];
        const MAX_SIZE = 100 * 1024 * 1024;
        if (f.size > MAX_SIZE) { setErrors(prev => ({ ...prev, upload: '视频大小需 ≤ 100MB' })); return; }
        try {
          const resp = await api.uploadPreviewVideo(f);
          const data = resp?.data;
          if (data?.id && data?.url) {
            if (videoTempId) { try { await api.deletePreviewTemp('video', videoTempId); } catch(_){} }
            // Keep the real File object for final submit
            setVideoFile(f);
            setVideoTempId(data.id);
            setVideoPreviewUrl(data.url);
            if (errors.upload) setErrors(prev => ({ ...prev, upload: '' }));
          } else {
            setErrors(prev => ({ ...prev, upload: '预览失败' }));
        }
        } catch (e) { setErrors(prev => ({ ...prev, upload: '上传失败' })); }
        return;
      }

      if (creationType !== 'image') return;
      await handleAddImages(acceptedFiles);
    }
  });

  // 全局粘贴：仅图片模式启用
  useEffect(() => {
    if (creationType !== 'image') return;
    const onPaste = async (e) => {
      try {
        // 如果当前在可编辑输入中
        const target = e.target;
        const editable = !!(target && (target.closest && target.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')));
        const dt = e.clipboardData || window.clipboardData;
        if (!dt) return;
        const items = Array.from(dt.items || []);
        const imageFiles = items.filter(it => it.kind === 'file' && it.type && it.type.startsWith('image/')).map(it => it.getAsFile()).filter(Boolean);
        const textPlain = (dt.getData && dt.getData('text/plain')) || '';

        if (editable) {
          // 文本框中：如果是纯图片粘贴，提示并阻止；如果有文本则保持默认粘贴
          const hasText = !!(textPlain && textPlain.trim());
          if (imageFiles.length > 0 && !hasText) {
            e.preventDefault();
            try { toast.info('文本框不支持图片上传，请在左侧图片区域粘贴'); } catch(_){}
          }
          return; // 在输入框中不触发上传
        }

        // 非输入区域：有图片则当作上传；只有文本则提示去文本框粘贴
        if (imageFiles.length > 0) {
          e.preventDefault();
          if (isSorting) return;
          await handleAddImages(imageFiles);
        } else if ((textPlain || '').trim()) {
          try { toast.info('检测到文本，请粘贴到右侧文本框中'); } catch(_){}
        }
      } catch (_) {}
    };
    window.addEventListener('paste', onPaste, true);
    return () => window.removeEventListener('paste', onPaste, true);
  }, [creationType, uiOrder, isSorting]);

  const renderFileUpload = () => {
  if (creationType === 'image') {
    return (
      <div className='form-group'>
        <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'8px' }}>
          <button type='button' className='btn btn--secondary' onClick={open} disabled={isUploading}>添加图片</button>
          <span style={{ fontSize:'12px', color:'#6b7280' }}>最多 20 张，每张 ≤ 10MB，拖动图片排序，第一张图为封面，支持 Ctrl+V 粘贴上传</span>
        </div>
        <input {...getInputProps()} style={{ display:'none' }} />
        {uiOrder.length > 0 && (
          <div {...getRootProps()} className='media-masonry'>
            {uiOrder.map((m, idx) => (
              <div
                key={(m.kind==='existing'?'e':'p') + (m.id || m.tempId)}
                className='media-cell'
                draggable
                onDragStart={(e)=>{ 
                  setDraggingIndex(idx);
                  setIsSorting(true);
                  try { e.dataTransfer.effectAllowed = 'move'; } catch(_){}
                  try { e.dataTransfer.setData('text/plain', String(idx)); } catch(_){}
                }}
                onDragEnd={()=>{ setDraggingIndex(null); setIsSorting(false); }}
                onDragOver={(e)=>{ e.preventDefault(); }}
                onDrop={(e)=>{ 
                  e.preventDefault();
                  e.stopPropagation();
                  const from = Number.isInteger(draggingIndex) ? draggingIndex : parseInt(e.dataTransfer.getData('text/plain'));
                  if (!Number.isInteger(from)) { setDraggingIndex(null); setIsSorting(false); return; }
                  const to = idx;
                  if (from === to) { setDraggingIndex(null); setIsSorting(false); return; }
                  setUiOrder(prev => { const arr=[...prev]; const [it]=arr.splice(from,1); arr.splice(to,0,it); return arr; });
                  setDraggingIndex(null); setIsSorting(false);
                }}
              >
                <img
                  alt=''
                  src={ m.kind==='existing' ? (m.thumb ? ('/uploads/thumbnails/' + m.thumb) : ('/uploads/' + m.path)) : m.previewUrl }
                  className='media-img'
                  draggable={false}
                  onClick={() => setPreviewIndex(idx)}
                />
                <button
                  type='button'
                  className='media-remove'
                  onClick={() => {
                    if (m.kind==='existing') {
                      api.deleteMedia(item.id, m.id).then(()=> setUiOrder(prev => prev.filter((_,i)=>i!==idx))).catch(()=>{});
                    } else {
                      (async () => { try { if (m.tempId) await api.deletePreviewTemp('image', m.tempId); } catch(_){} })();
                      setUiOrder(prev => prev.filter((_,i)=>i!==idx));
                    }
                  }}
                  disabled={isUploading}
                  aria-label='Delete'
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}
        {errors.upload && <div className='form-error'>{errors.upload}</div>}
      </div>
    );
  }
  if (creationType === 'video') {
    const effectiveItem = serverItem || item;
    const showButton = !(mode === 'edit' && effectiveItem?.file_path && !videoFile);
    const videoUrl = videoPreviewUrl || (effectiveItem?.file_path ? ('/uploads/' + effectiveItem.file_path) : '');
    return (
      <div className='form-group'>
        <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'8px', flexWrap:'wrap' }}>
          {showButton && (
            <button type='button' className='btn btn--secondary' onClick={open} disabled={isUploading}>选择视频</button>
          )}
          {videoFile && (
            <button type='button' className='btn' onClick={async () => { try { if (videoTempId) await api.deletePreviewTemp('video', videoTempId); } catch(_){} setVideoFile(null); setVideoTempId(''); setVideoPreviewUrl(''); }} disabled={isUploading}>移除</button>
          )}
          {mode === 'edit' && effectiveItem?.file_path && !videoFile && (
            <button type='button' className='btn btn--danger' onClick={async () => {
              try {
                setIsUploading(true);
                await api.deleteVideo(effectiveItem.id || item.id);
                const full = await api.getItem(effectiveItem.id || item.id);
                setServerItem(full?.data || { ...(effectiveItem || {}), file_path: null, thumbnail_path: null });
                toast.success('已移除视频');
              } catch (e) {
                toast.error(e.response?.data?.error?.message || '删除视频失败');
              } finally { setIsUploading(false); }
            }} disabled={isUploading}>删除视频</button>
          )}
          <span style={{ fontSize:'12px', color:'#6b7280' }}>1 个视频，≤ 100MB</span>
        </div>
        <input {...getInputProps()} style={{ display:'none' }} />
        {videoUrl ? (
          <video src={videoUrl} controls style={{ width:'100%', maxHeight:'420px', background:'#000', borderRadius:'8px' }} />
        ) : null}
        {errors.upload && <div className='form-error'>{errors.upload}</div>}
      </div>
    );
  }
  return null;
};

const handleSubmit = (e) => {
    e.preventDefault();
    const newErrors = {};
    if (!formData.title.trim()) newErrors.title = '标题不能为空';
    if (creationType === 'text') {
      const hasContent = formData.segments && formData.segments.some(s => (s.title||'').trim() || (s.content||'').trim());
      if (!hasContent) newErrors.segments = '内容不能为空';
    }
      if (creationType === 'image' && uiOrder.length === 0) newErrors.upload = '请至少添加一张图片'
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    const segmentsContent = JSON.stringify(formData.segments);
    const commonData = {
      title: formData.title.trim(),
      content: segmentsContent,
      folder_id: formData.folder_id || null,
      tag_ids: formData.tag_ids || [],
      is_favorite: !!formData.is_favorite,
      // 缁熶竴鍒嗙被锛歵ext / image / video锛堜笁閫変竴锛夛紝涓嶅啀鍐欏叿浣揗IME
      content_type: creationType === 'text' ? 'text' : (creationType === 'image' ? 'image' : 'video')
    };

    const run = async () => {
      try {
        setIsUploading(true);
        if (creationType === 'image') {
          let currentItemId = item?.id;
          if (mode === 'create') {
            const r = await api.createItem(commonData);
            if (!r?.data?.id) throw new Error('创建条目失败');
            currentItemId = r.data.id;
          } else {
            await api.updateItem(item.id, commonData);
            currentItemId = item.id;
          }
          const tempToNewId = {};
          for (const entry of uiOrder) {
            if (entry.kind === 'pending') {
              const resp = await api.uploadMedias(currentItemId, [entry.file]);
              const inserted = resp?.data || [];
              if (inserted[0]?.id) tempToNewId[entry.tempId] = inserted[0].id;
            }
          }
          const order = uiOrder.map(entry => ({ id: entry.kind === 'existing' ? entry.id : tempToNewId[entry.tempId] })).filter(o => o && o.id);
          if (order.length > 0) await api.updateMediaOrder(currentItemId, order);
          queryClient.invalidateQueries('items');
          toast.success('已保存图片及顺序');
          // 鑻ユ槸鏂板缓锛屽垏鎹㈠埌缂栬緫鎬侊紝閬垮厤鍐嶆鐐瑰嚮瑙﹀彂閲嶅鍒涘缓
          if (mode === 'create' && typeof onCreated === 'function') {
            try {
              const full = await api.getItem(currentItemId);
              onCreated(full?.data || { id: currentItemId, ...commonData });
            } catch (_) {
              onCreated({ id: currentItemId, ...commonData });
            }
          }
        } else if (creationType === 'video') {
          if (mode === 'create') {
            if (!videoFile) { setErrors(prev => ({ ...prev, upload: '请先选择视频' })); return; }
            const res = await api.uploadFile(videoFile, commonData);
            // 鍒囨崲鍒扮紪杈戞€侊紝闃叉鐢ㄦ埛鍐嶆鐐瑰嚮閫犳垚閲嶅杞爜
            if (typeof onCreated === 'function' && res?.data) {
              onCreated(res.data);
            }
          } else {
            // 缂栬緫妯″紡锛氳嫢閫夋嫨浜嗘柊瑙嗛锛屽垯鏇挎崲瑙嗛骞惰浆鐮侊紱鍚﹀垯浠呬繚瀛樻枃鏈瓑淇℃伅
            if (videoFile) {
              const res = await api.replaceVideo(item.id, videoFile, commonData);
              try {
                const full = await api.getItem(item.id);
                setServerItem(full?.data || res?.data);
                toast.success('已替换视频');
              } catch (_) {}
              // 娓呯悊鏈湴閫夋嫨
              try { if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl); } catch(e){}
              setVideoFile(null); setVideoPreviewUrl('');
            } else {
              await api.updateItem(item.id, commonData);
            }
          }
          queryClient.invalidateQueries('items');
          toast.success('已保存');
        } else {
          // 文本：首次保存后需要切换到“编辑模式”，避免再次点击保存时重复创建
          if (mode === 'edit' && item) {
            await api.updateItem(item.id, commonData);
          } else {
            const res = await api.createItem(commonData);
            // 通知父层把界面从“新建”切到“编辑”，后续保存才会走更新
            if (typeof onCreated === 'function' && res?.data) {
              onCreated(res.data);
            }
          }
          queryClient.invalidateQueries('items');
          toast.success('已保存');
        }
      } catch (err) {
        console.error(err);
        setErrors(prev => ({ ...prev, submit: err.response?.data?.error?.message || err.message }));
      } finally {
        setIsUploading(false);
      }
    };

    run();
  };

  const handleCancel = () => { onCancel?.(); };

  const handleConfirmDelete = async () => {
    if (!item?.id) { setConfirmDeleteOpen(false); return; }
    try {
      setIsUploading(true);
      await api.deleteItem(item.id);
      queryClient.invalidateQueries('items');
      setConfirmDeleteOpen(false);
      onCancel?.();
    } catch (e) {
      console.error('Delete item failed', e);
      setErrors(prev => ({ ...prev, submit: e.response?.data?.error?.message || e.message }));
    } finally {
      setIsUploading(false);
    }
  };

  // 预览大图：仅在图片模式下启用
  const hasPreview = creationType === 'image' &&
    typeof previewIndex === 'number' &&
    previewIndex >= 0 &&
    previewIndex < uiOrder.length;
  const activePreview = hasPreview ? uiOrder[previewIndex] : null;

  const resolvePreviewUrl = (entry) => {
    if (!entry) return '';
    if (entry.kind === 'existing') {
      if (entry.path) return '/uploads/' + entry.path;
      if (entry.thumb) return '/uploads/thumbnails/' + entry.thumb;
      return '';
    }
    return entry.previewUrl || '';
  };

  const closePreview = () => { setPreviewIndex(null); };
  const goPrevPreview = (e) => {
    if (e) e.stopPropagation();
    if (!uiOrder || uiOrder.length <= 1) return;
    setPreviewIndex(prev => (typeof prev === 'number' ? (prev - 1 + uiOrder.length) % uiOrder.length : 0));
  };
  const goNextPreview = (e) => {
    if (e) e.stopPropagation();
    if (!uiOrder || uiOrder.length <= 1) return;
    setPreviewIndex(prev => (typeof prev === 'number' ? (prev + 1) % uiOrder.length : 0));
  };

  return (
    <div className='creation-view'>
      <div className='creation-view__header'>
        <div className='creation-view__type-selector'>
            {['text', 'image', 'video'].map(type => (
              <button key={type} onClick={() => setCreationType(type)} className={`type-btn ${creationType === type ? 'active' : ''}`}>
              {type === 'text' ? '文本' : type === 'image' ? '图片' : '视频'}
              </button>
            ))}
        </div>
        {/* 顶部操作：顺序调整为 删除 | 保存 | 分享 | 退出，并将删除与其余按钮拉开间距 */}
        <div className='creation-view__actions creation-view__actions--header'>
          {mode === 'edit' && (
            <button
              type='button'
              className='btn btn--danger header-btn-danger'
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={isUploading}
            >
              删除
            </button>
          )}
          {/* 保存 */}
          <button
            type='submit'
            form='creation-form'
            className='btn btn--primary'
            disabled={isUploading}
          >
            {isUploading ? '保存中...' : '保存'}
          </button>
          {/* 分享：仅编辑已有内容时可用；否则提示先保存 */}
          <button
            type='button'
            className='btn btn--secondary'
            onClick={() => {
              if (!(mode === 'edit' && item?.id)) {
                try { toast.info('请先保存后再分享'); } catch (_) {}
                return;
              }
              setShareOpen(true);
            }}
            disabled={isUploading}
          >
            分享
          </button>
          {/* 退出 */}
          <button type='button' className='btn btn--secondary' onClick={handleCancel} disabled={isUploading}>退出</button>
        </div>
      </div>

      <form
        id='creation-form'
        onSubmit={handleSubmit}
        className='creation-view__form'
      >
        <div className='creation-view__form-left'>
          {creationType === 'text' ? (
            <>
              <div className='form-group'>
                <label className='form-label'>文件夹（必填）</label>
                {renderFolderSelector()}
              </div>
              {renderTagSelector()}
            </>
          ) : (
            renderFileUpload()
          )}
        </div>

        <div className='creation-view__form-right'>
          <div className='form-group'>
            <label className='form-label'>标题（必填）</label>
            <input type='text' name='title' value={formData.title} onChange={onInputChange} className={`form-input ${errors.title ? 'error' : ''}`} placeholder='请输入...' disabled={isUploading}/>
            {errors.title && <div className='form-error'>{errors.title}</div>}
          </div>

          {/* 媒体（图片/视频）模式：将“文件夹 + 标签”移动到标题下面 */}
          {(creationType === 'image' || creationType === 'video') && (
            <>
              <div className='form-group'>
                <label className='form-label'>文件夹（必填）</label>
                {renderFolderSelector()}
              </div>
              {renderTagSelector()}
            </>
          )}

          {/* 分段编辑区域放在“文件夹 + 标签”之后 */}
          <SegmentedPrompt segments={formData.segments} onChange={onSegmentsChange} />
          {errors.segments && <div className='form-error'>{errors.segments}</div>}

          {/* 鍔犲叆鏀惰棌鍔熻兘鏆傛椂涓嬬嚎锛氭寜闇€姹傞殣钘忕紪杈戦〉鐨勬敹钘忛€夐」 */}

          {isUploading && <div className='upload-progress'>...</div>}
          {errors.submit && <div className='form-error form-error--block'>{errors.submit}</div>}

          {/* 搴曢儴鎿嶄綔鍖哄凡涓婄Щ鑷虫爣棰樻爮 */}
        </div>
      </form>

      {activePreview && (
        <div className='media-preview-backdrop' onClick={closePreview}>
          <div className='media-preview-modal' onClick={(e) => e.stopPropagation()}>
            <button
              type='button'
              className='media-preview-close'
              onClick={closePreview}
              aria-label='关闭'
            >
              &times;
            </button>
            <div className='media-preview-body'>
              <img
                src={resolvePreviewUrl(activePreview)}
                alt={formData.title || '预览图片'}
                className='media-preview-image'
              />
              {uiOrder.length > 1 && (
                <>
                  <button
                    type='button'
                    className='media-preview-nav prev'
                    onClick={goPrevPreview}
                    aria-label='上一张'
                  >
                    ‹
                  </button>
                  <button
                    type='button'
                    className='media-preview-nav next'
                    onClick={goNextPreview}
                    aria-label='下一张'
                  >
                    ›
                  </button>
                </>
              )}
            </div>
            {uiOrder.length > 1 && (
              <div className='media-preview-meta'>
                {previewIndex + 1} / {uiOrder.length}
              </div>
            )}
          </div>
        </div>
      )}

      {shareOpen && (
        <ShareModal isOpen={shareOpen} onClose={() => setShareOpen(false)} itemId={item?.id} />
      )}
            <ConfirmModal
        isOpen={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={handleConfirmDelete}
        title='删除条目'
        message='确认删除该条目？此操作无法撤销。'
        confirmText='删除'
        type='danger'
      />
    </div>
  );
};

export default CreationView;





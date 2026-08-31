import fs from 'fs';

let html = fs.readFileSync('public/review_workbench_utf8.html', 'utf-8');

// 1. 在 DOM 中为第 3 列增加常驻独立的 20 窗面板容器
const thirdColTarget = '<div class="column-body" id="l2b-gates-list"></div>';
const thirdColReplacement = `<div class="column-body">
        <!-- 上半部分: 当日战法命中 + 周哥体制 (受日期筛选驱动) -->
        <div id="l2b-gates-list"></div>
        
        <!-- 下半部分: 独立常驻 20 窗切窗样本透视面板 (固定样本，不受日期下拉影响) -->
        <div style="margin-top: 16px; border-top: 1px solid var(--border); padding-top: 12px;">
          <details id="l2b-drycut-container" open style="border: 1px solid #8957e5; background: #12161c; border-radius: 4px; padding: 6px;">
            <summary style="color: #d2a8ff; font-size: 12px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: bold;">
              <span>🧪 L2b 20 窗切窗固定样本透视</span>
              <span style="font-size: 10px; background: rgba(137,87,229,0.25); color: #d2a8ff; padding: 2px 6px; border-radius: 4px;">常驻 20 窗</span>
            </summary>
            <div id="l2b-drycut-list" style="margin-top: 8px; display: flex; flex-direction: column; gap: 8px;">
              <div style="color: var(--text-muted); font-size: 11px;">正在加载 20 窗切窗样本...</div>
            </div>
          </details>
        </div>
      </div>`;

html = html.replace(thirdColTarget, thirdColReplacement);

// 2. 插入图片放大模态框
const modalHtml = `
  <!-- 图片放大查看模态框 Modal -->
  <div id="image-modal" style="display:none; position:fixed; z-index:9999; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); justify-content:center; align-items:center; cursor:zoom-out;" onclick="this.style.display='none'">
    <img id="modal-img" src="" style="max-width:92%; max-height:92%; border-radius:6px; box-shadow:0 0 20px rgba(0,0,0,0.8); border:1px solid #30363d;">
  </div>
`;
html = html.replace('</body>', modalHtml + '\n</body>');

// 3. 在 initWorkbench 中加入 loadDryCut20Samples() 调用
html = html.replace('await initDates();', 'await initDates();\n      loadDryCut20Samples();');

// 4. 移除 loadGates 内部的重复挂载代码
const duplicateTarget = `        // 挂载 L2b 20 窗 Dry-Cut 样本与真图穿透模块
        const drycutSection = document.createElement('details');
        drycutSection.open = false;
        drycutSection.style.marginTop = '12px';
        drycutSection.style.border = '1px solid #a371f7';
        drycutSection.innerHTML = \`
          <summary style="color: #d2a8ff; font-size: 12px; cursor: pointer;">🧪 L2b 20 窗切窗样本透视 (点开查验 raw_text / 配图 / 纯汉字证据)</summary>
          <div id="l2b-drycut-list" style="margin-top: 8px; display: flex; flex-direction: column; gap: 8px;">
            <div style="color: var(--text-muted); font-size: 11px;">正在加载 20 窗切窗样本...</div>
          </div>
        \`;
        container.appendChild(drycutSection);
        loadDryCut20Samples();`;

if (html.includes(duplicateTarget)) {
  html = html.replace(duplicateTarget, '');
}

// 5. 替换 loadDryCut20Samples 为支持「切图联动显示对应对话来源、发言人、发送时间与消息说明」的完整版本
const oldFuncStart = 'async function loadDryCut20Samples()';
const oldFuncEnd = 'function selectCu(cuId, e)';
const idxStart = html.indexOf(oldFuncStart);
const idxEnd = html.indexOf(oldFuncEnd);

const newFunctions = `// 辅助清洗 raw_text，将超长 [IMAGE:https://...] 替换为简洁提示
    function cleanRawTextForDisplay(text) {
      if (!text) return '';
      return text.replace(/\\[IMAGE:https?:\\/\\/[^\\]]+\\]/g, '🖼️ [原图链接（已过期）/ 见上方真图]');
    }

    // 弹窗放大真图
    function showModalImage(imgSrc) {
      const modal = document.getElementById('image-modal');
      const modalImg = document.getElementById('modal-img');
      modalImg.src = imgSrc;
      modal.style.display = 'flex';
    }

    // 全局存储 20 窗中各窗当前选中的图片索引与多图数据
    window.cuImageIndexes = window.cuImageIndexes || {};
    window.cuImagesData = window.cuImagesData || {};

    function switchCuImage(cuId, delta) {
      const imgs = window.cuImagesData[cuId] || [];
      if (imgs.length <= 1) return;
      let cur = window.cuImageIndexes[cuId] || 0;
      cur = (cur + delta + imgs.length) % imgs.length;
      window.cuImageIndexes[cuId] = cur;

      const activeImg = imgs[cur];
      const imgElem = document.getElementById('img-view-' + cuId);
      const shaElem = document.getElementById('img-sha-' + cuId);
      const pagerElem = document.getElementById('img-pager-' + cuId);
      const metaElem = document.getElementById('img-meta-' + cuId);
      const captionElem = document.getElementById('img-caption-' + cuId);

      if (imgElem) {
        imgElem.src = activeImg.web_url;
      }
      if (shaElem) shaElem.innerText = '🖼️ 附图核准 (SHA: ' + activeImg.image_sha + ')';
      if (pagerElem) pagerElem.innerText = (cur + 1) + ' / ' + imgs.length;
      if (metaElem) metaElem.innerHTML = '🔑 来源消息: <code style="color:#58a6ff;">' + escapeHtml(activeImg.post_id) + '</code> (' + escapeHtml(activeImg.time_et || '美东时间') + ' · ' + escapeHtml(activeImg.sender_name || 'xiaozhaolucky') + ')';
      if (captionElem) captionElem.innerHTML = '💬 <strong>同帖口播:</strong> ' + escapeHtml(activeImg.post_caption || '无文字口播（纯图消息）');
    }

    async function loadDryCut20Samples() {
      try {
        const res = await fetch('/api/l2b/drycut20');
        const data = await res.json();
        const box = document.getElementById('l2b-drycut-list');
        if (!box) return;
        if (!data.success || !data.windows) {
          box.innerHTML = \`<div style="color: #f85149; font-size: 11px;">加载样本失败: \${data.error}</div>\`;
          return;
        }

        box.innerHTML = '';
        data.windows.forEach((w, idx) => {
          const item = document.createElement('div');
          item.style.padding = '8px';
          item.style.background = '#161b22';
          item.style.border = '1px solid var(--border)';
          item.style.borderRadius = '4px';
          item.style.fontSize = '11px';

          // 整理窗内全部有效真图
          const rawImgs = (Array.isArray(w.images) && w.images.length > 0)
            ? w.images
            : (w.has_real_image && w.local_image_path && w.local_image_path !== 'no_image' 
                ? [{ local_path: w.local_image_path, image_sha: w.image_sha, post_id: w.post_id, sender_name: 'xiaozhaolucky', time_et: w.et_date, post_caption: w.statement }] 
                : []);

          const validImages = rawImgs.map(img => ({
            local_path: img.local_path,
            web_url: img.local_path.replace(/\\\\/g, '/').replace(/^data\\/media\\/zhao\\//, '/media/zhao/'),
            image_sha: img.image_sha,
            post_id: img.post_id || w.post_id,
            sender_name: img.sender_name || 'xiaozhaolucky',
            time_et: img.time_et || w.et_date,
            post_caption: img.post_caption || '无文字口播（纯图消息）'
          }));

          window.cuImagesData[w.cu_id] = validImages;
          window.cuImageIndexes[w.cu_id] = 0;

          const hasImgs = validImages.length > 0;
          const activeImg = hasImgs ? validImages[0] : null;

          const seedBadge = w.seed_id ? \`<span class="badge" style="background:#8957e5; color:#fff; padding:1px 5px; border-radius:3px;">⭐ \` + escapeHtml(w.seed_id) + \`</span>\` : '';
          const cleanedRaw = cleanRawTextForDisplay(w.raw_text);

          let imageSectionHtml = '';
          if (hasImgs) {
            const multiControl = validImages.length > 1 ? \`
              <button onclick="switchCuImage('\` + escapeHtml(w.cu_id) + \`', -1)" style="background:#21262d; border:1px solid #30363d; color:#c9d1d9; border-radius:3px; padding:1px 5px; font-size:10px; cursor:pointer;">◀ 上一张</button>
              <span id="img-pager-\` + escapeHtml(w.cu_id) + \`" style="font-size:10px; color:#58a6ff; font-weight:bold;">1 / \` + validImages.length + \`</span>
              <button onclick="switchCuImage('\` + escapeHtml(w.cu_id) + \`', 1)" style="background:#21262d; border:1px solid #30363d; color:#c9d1d9; border-radius:3px; padding:1px 5px; font-size:10px; cursor:pointer;">下一张 ▶</button>
            \` : '';

            imageSectionHtml = \`
              <div style="margin:6px 0; padding:8px; background:#0d1117; border-radius:4px; border:1px solid #30363d;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                  <span id="img-sha-\` + escapeHtml(w.cu_id) + \`" style="color:#3fb950; font-weight:bold; font-size:10px;">🖼️ 附图核准 (SHA: \` + escapeHtml(activeImg.image_sha) + \`)</span>
                  <div style="display:flex; align-items:center; gap:6px;">
                    \` + multiControl + \`
                    <span style="color:#58a6ff; font-size:10px; cursor:pointer; margin-left:4px;" onclick="const im = document.getElementById('img-view-\` + escapeHtml(w.cu_id) + \`'); if(im) showModalImage(im.src);">🔍 放大</span>
                  </div>
                </div>
                <div style="text-align:center; background:#010409; border-radius:4px; padding:4px;">
                  <img id="img-view-\` + escapeHtml(w.cu_id) + \`" src="\` + escapeHtml(activeImg.web_url) + \`" style="max-width:100%; max-height:170px; object-fit:contain; border-radius:4px; cursor:zoom-in;" onclick="showModalImage(this.src)" onerror="this.style.display='none'">
                </div>
                <div style="margin-top:6px; padding:6px; background:#161b22; border:1px solid #21262d; border-radius:3px;">
                  <div id="img-meta-\` + escapeHtml(w.cu_id) + \`" style="font-size:10px; color:var(--text-muted); margin-bottom:2px;">
                    🔑 来源消息: <code style="color:#58a6ff;">\` + escapeHtml(activeImg.post_id) + \`</code> (\` + escapeHtml(activeImg.time_et) + \` · \` + escapeHtml(activeImg.sender_name) + \`)
                  </div>
                  <div id="img-caption-\` + escapeHtml(w.cu_id) + \`" style="font-size:10px; color:#c9d1d9; line-height:1.3;">
                    💬 <strong>同帖口播:</strong> \` + escapeHtml(activeImg.post_caption) + \`
                  </div>
                </div>
              </div>
            \`;
          } else {
            imageSectionHtml = \`<div style="font-size:10px; color:var(--text-muted); margin:4px 0;">配图状态: <span style="color:#8b949e;">no_image</span></div>\`;
          }

          item.innerHTML = \`
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <span style="font-weight:bold; color:#58a6ff;">[\` + (idx+1) + \`] \` + escapeHtml(w.cu_id) + \`</span>
              \` + seedBadge + \`
            </div>
            <div style="color:var(--text-muted); margin-bottom:4px; font-size:10px;">
              📡 \` + escapeHtml(w.channel_name) + \` | 🔑 锚点: \` + escapeHtml(w.post_id) + \` | 🏷️ <span style="color:#d2a8ff; font-weight:bold;">\` + escapeHtml(w.kid) + \`</span>
            </div>
            <div style="margin-bottom:6px; color:#f0f6fc; line-height:1.3;"><strong>口诀:</strong> \` + escapeHtml(w.statement) + \`</div>
            \` + imageSectionHtml + \`
            <details style="margin-top:6px; background:#0d1117; border:1px solid #21262d; border-radius:3px; padding:4px 6px;">
              <summary style="color:var(--accent); font-size:11px; cursor:pointer;">📖 展开 raw_text 上下文 (\` + w.dialogue_message_count + \`条同频对话)</summary>
              <pre style="margin-top:6px; white-space:pre-wrap; font-size:10px; color:var(--text); line-height:1.4; max-height:200px; overflow-y:auto;">\` + escapeHtml(cleanedRaw) + \`</pre>
            </details>
          \`;
          box.appendChild(item);
        });
      } catch (e) {
        console.error("加载 20 窗样本异常:", e);
      }
    }

    `;

if (idxStart !== -1 && idxEnd !== -1) {
  html = html.substring(0, idxStart) + newFunctions + html.substring(idxEnd);
}

fs.writeFileSync('public/review_workbench.html', html, 'utf-8');
console.log('✅ review_workbench.html 升级图文对话联动说明成功！');

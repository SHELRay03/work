// asset version: 13 — 改动任一包请整体 bump
// 依赖外部：无
// 导出：escapeHtml, escapeHtmlAttr, saveFilesToFolder, showToast, showConfirm, closeToast

/**
 * 通用工具函数
 * 从各 HTML 页面内联 script 中抽离的重复定义，统一在此维护。
 */

/**
 * HTML 文本转义，防止 XSS
 * 用于 innerHTML 场景下的文本内容（非属性值）。
 * @param {*} s - 待转义的内容
 * @returns {string} 转义后的字符串
 */
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * HTML 属性值转义（在 escapeHtml 基础上额外转义双引号）
 * 用于 attribute="..." 场景，防止引号注入。
 * @param {*} s - 待转义的内容
 * @returns {string} 转义后的字符串
 */
function escapeHtmlAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

/**
 * 使用 File System Access API 将文件写入文件夹
 * 返回 { success, message }
 * @param {Array<{path: string, content: string}>} fileMap - 文件映射
 * @param {FileSystemDirectoryHandle|null} dirHandle - 已选目录句柄；传入时跳过目录选择器
 */
async function saveFilesToFolder(fileMap, dirHandle = null) {
  if (!window.showDirectoryPicker) {
    return { success: false, message: '当前浏览器不支持文件夹导出，请使用 Chrome/Edge 或选择 ZIP 导出' };
  }

  try {
    if (!dirHandle) {
      dirHandle = await window.showDirectoryPicker();
    }

    for (const { path, content } of fileMap) {
      const parts = path.split('/');
      let current = dirHandle;

      // 创建子文件夹
      for (let i = 0; i < parts.length - 1; i++) {
        current = await current.getDirectoryHandle(parts[i], { create: true });
      }

      const fileName = parts[parts.length - 1];
      const fileHandle = await current.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
    }

    return { success: true, message: `已保存 ${fileMap.length} 个文件` };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { success: false, message: '已取消保存' };
    }
    return { success: false, message: '保存失败：' + err.message };
  }
}

/* ====================== Toast 通知系统 ====================== */

/**
 * Toast 类型配置：图标、时长、role
 */
const TOAST_TYPES = {
  info:    { icon: 'i', duration: 3000, role: 'status'  },
  success: { icon: '✓', duration: 3000, role: 'status'  },
  warning: { icon: '!', duration: 4000, role: 'status'  },
  error:   { icon: '×', duration: 5000, role: 'alert'   }
};

/**
 * 懒创建 Toast 容器（全局唯一，挂载到 body 末尾）
 * @returns {HTMLElement}
 */
function ensureToastContainer() {
  let el = document.getElementById('toastContainer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toastContainer';
    el.className = 'toast-container';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', '通知');
    document.body.appendChild(el);
  }
  return el;
}

/**
 * 关闭并移除一个 Toast 节点
 * @param {HTMLElement} toast
 */
function closeToast(toast) {
  if (!toast || !toast.parentNode) return;
  toast.classList.remove('is-visible');
  toast.classList.add('is-leaving');
  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 200);
}

/**
 * 显示一个 Toast 通知
 * @param {string} message - 文本内容
 * @param {'info'|'success'|'warning'|'error'} [type='info'] - 类型
 * @param {Object} [opts] - 扩展配置
 * @param {number} [opts.duration] - 自定义时长(ms)；0 表示不自动消失
 * @param {{label:string, onClick:Function}} [opts.action] - 动作按钮
 * @returns {HTMLElement} toast 节点
 */
function showToast(message, type = 'info', opts = {}) {
  const cfg = TOAST_TYPES[type] || TOAST_TYPES.info;
  const container = ensureToastContainer();

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', cfg.role);

  const iconWrap = document.createElement('span');
  iconWrap.className = 'toast-icon';
  iconWrap.setAttribute('aria-hidden', 'true');
  iconWrap.textContent = cfg.icon;

  const msg = document.createElement('span');
  msg.className = 'toast-msg';
  msg.textContent = message;

  toast.appendChild(iconWrap);
  toast.appendChild(msg);

  if (opts.action && opts.action.label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = opts.action.label;
    btn.addEventListener('click', () => {
      try { if (opts.action.onClick) opts.action.onClick(); } finally { closeToast(toast); }
    });
    toast.appendChild(btn);
  }

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'toast-close';
  closeBtn.setAttribute('aria-label', '关闭');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => closeToast(toast));
  toast.appendChild(closeBtn);

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('is-visible'));

  const duration = opts.duration != null ? opts.duration : cfg.duration;
  if (duration > 0) {
    setTimeout(() => closeToast(toast), duration);
  }
  return toast;
}

/**
 * 显示一个需要确认的 Toast（替代原生 confirm）
 * @param {string} message - 确认提示文本
 * @param {Function} onConfirm - 用户点击确认后的回调
 * @param {Object} [opts] - 扩展配置
 * @param {string} [opts.okLabel='确认'] - 确认按钮文案
 * @param {string} [opts.cancelLabel='取消'] - 取消按钮文案
 * @returns {HTMLElement} toast 节点
 */
function showConfirm(message, onConfirm, opts = {}) {
  const toast = showToast(message, 'warning', { duration: 0 });

  const actions = document.createElement('div');
  actions.className = 'toast-actions';

  const okBtn = document.createElement('button');
  okBtn.type = 'button';
  okBtn.className = 'toast-confirm-btn';
  okBtn.textContent = opts.okLabel || '确认';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'toast-cancel-btn';
  cancelBtn.textContent = opts.cancelLabel || '取消';

  okBtn.addEventListener('click', () => {
    closeToast(toast);
    try { if (onConfirm) onConfirm(); } catch (e) { console.error(e); }
  });
  cancelBtn.addEventListener('click', () => closeToast(toast));

  actions.appendChild(cancelBtn);
  actions.appendChild(okBtn);

  // 确认型 toast 移除右上角关闭按钮，避免重复
  const closeBtn = toast.querySelector('.toast-close');
  if (closeBtn) closeBtn.remove();
  toast.appendChild(actions);
  return toast;
}

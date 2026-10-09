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

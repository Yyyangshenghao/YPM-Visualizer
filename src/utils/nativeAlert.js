/**
 * Returns an alert-like function that fits current runtime environment
 *
 * This function is amid to solve a electron bug on Windows, that, when
 * user dismissed a browser alert, <input> elements cannot be focused
 * for further editing unless switching to another window and then back
 *
 * @returns { (message:string) => void }
 * Built-in alert function for browser environment
 * A function wrapping {@link dialog.showMessageBoxSync} for electron environment
 *
 * @see {@link https://github.com/electron/electron/issues/19977} for upstream electron issue
 */
const nativeAlert = (() => {
  if (process.env.IS_ELECTRON === true) {
    try {
      // 使用 window.require 避免 webpack 打包 electron 模块及其 Node.js 内置依赖（如 fs），
      // 导致 webpack target: 'web' 时用空对象 {} mock fs，运行时 fs.existsSync 报错
      // 项目中其他文件（Player.js, Win32Titlebar.vue 等）也用 window.require 绕过 webpack 静态分析
      const { dialog } = window.require('electron');
      if (dialog) {
        return message => {
          var options = {
            type: 'warning',
            message,
          };
          dialog.showMessageBoxSync(null, options);
        };
      }
    } catch (e) {
      console.warn(
        '[nativeAlert] Failed to load electron dialog, falling back to alert:',
        e.message
      );
    }
  }
  return alert;
})();

export default nativeAlert;

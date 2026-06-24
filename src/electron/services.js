import clc from 'cli-color';
import checkAuthToken from '../utils/checkAuthToken';

export async function startNeteaseMusicApi() {
  console.log(`${clc.redBright('[NetEase API]')} initiating NCM API`);

  // 初始化：确保 anonymous_token 文件存在（与 app.js 一致）
  const fs = require('fs');
  const path = require('path');
  const tmpPath = require('os').tmpdir();
  const anonymousTokenPath = path.resolve(tmpPath, 'anonymous_token');
  if (!fs.existsSync(anonymousTokenPath)) {
    fs.writeFileSync(anonymousTokenPath, '', 'utf-8');
  }

  // 设置随机中国 IP
  const {
    generateRandomChineseIP,
  } = require('@neteaseapireborn/api/util/index');
  global.cnIp = generateRandomChineseIP();

  // 注册匿名 token（让后续 API 请求不被网易云风控）
  try {
    console.log(
      `${clc.redBright('[NetEase API]')} registering anonymous token...`
    );
    const register_anonimous = require('@neteaseapireborn/api/module/register_anonimous');
    const request = require('@neteaseapireborn/api/util/request');
    const res = await register_anonimous({}, (...args) => request(...args));
    const cookie = res.body && res.body.cookie;
    if (cookie) {
      const { cookieToJson } = require('@neteaseapireborn/api/util/index');
      const cookieObj = cookieToJson(cookie);
      fs.writeFileSync(anonymousTokenPath, cookieObj.MUSIC_A, 'utf-8');
      console.log(
        `${clc.redBright('[NetEase API]')} anonymous token registered`
      );
    }
  } catch (error) {
    console.log(
      `${clc.redBright('[NetEase API]')} anonymous token registration failed:`,
      error.message
    );
  }

  // 启动 API 服务
  const server = require('@neteaseapireborn/api/server');
  await server.serveNcmApi({
    port: 10754,
    moduleDefs: require('../ncmModDef'),
  });
}

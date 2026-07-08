/**

 * 千帆订单 package/detail（eva + xhs 签名）

 * 优先 token 直连，避免每次弹 Python 黑窗；签名仅作兜底。

 */

const path = require('path');



const EVA_ORIGIN = 'https://eva.xiaohongshu.com';

const DEFAULT_UA =

  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) eva/1.2.6 Chrome/128.0.6613.186 Electron/32.2.8 Safari/537.36';



function loadSigner() {

  const botRoot = path.resolve(__dirname, '..', '..', '千帆中转机器人');

  try {

    const mod = require(path.join(botRoot, 'src', 'protocol', 'qianfan-order-xhs-sign.js'));

    return { buildSignedOrderFetchHeaders: mod.buildSignedOrderFetchHeaders, source: 'qianfan-bot' };

  } catch {

    return null;

  }

}



function extractAtToken(cookie) {

  const text = String(cookie || '');

  const patterns = [

    /access-token-walle\.xiaohongshu\.com=customer\.eva\.(AT-[A-Za-z0-9]+)/i,

    /walle-eva-auth=[^!]*!!(AT-[A-Za-z0-9]+)/i,

  ];

  for (const re of patterns) {

    const m = text.match(re);

    if (m) return m[1];

  }

  return '';

}



function buildFallbackHeaders(cookie, packageId) {

  const at = extractAtToken(cookie);

  if (!at) return null;

  const pid = String(packageId || '').trim();

  return {

    Accept: 'application/json, text/plain, */*',

    Cookie: cookie,

    Authorization: at.startsWith('AT-') ? at : `AT-${at}`,

    'User-Agent': DEFAULT_UA,

    Referer: pid

      ? `https://walle.xiaohongshu.com/cstools/tools/packages/${pid}`

      : 'https://walle.xiaohongshu.com/cstools/seller/dashboard',

    'x-subsystem': 'eva',

  };

}



function buildSignedHeaders(shopConfig, url, packageId) {

  const signer = loadSigner();

  if (!signer) return null;

  try {

    return {

      headers: signer.buildSignedOrderFetchHeaders(shopConfig, url, {

        referer: `https://walle.xiaohongshu.com/cstools/tools/packages/${packageId}`,

      }),

      via: 'xhs-sign',

    };

  } catch (err) {

    return { error: err };

  }

}



function isAuthOrSignFailure(status, json, text) {

  if (status === 401 || status === 403) return true;

  const msg = String(json?.msg || json?.message || text || '');

  return /签名|sign|token|登录|未授权|无权限|401|403/i.test(msg);

}



async function requestPackageDetail(url, headers) {

  const res = await fetch(url, {

    method: 'GET',

    headers,

    signal: AbortSignal.timeout(15000),

  });

  const text = await res.text();

  let json = null;

  try {

    json = JSON.parse(text);

  } catch {

    json = null;

  }

  const ok = res.ok && json && (json.code === 0 || json.success === true);

  return { ok, res, json, text };

}



async function fetchPackageDetailByCookie(packageId, cookie) {

  const pid = String(packageId || '').trim();

  if (!pid) return { ok: false, error: 'missing_package_id' };

  const cookieStr = String(cookie || '').trim();

  if (!cookieStr) return { ok: false, error: 'missing_cookie' };



  const url = `${EVA_ORIGIN}/api/edith/package/${encodeURIComponent(pid)}/detail`;

  const shopConfig = { cookie: cookieStr, userAgent: DEFAULT_UA, lastPackageId: pid };



  const tokenHeaders = buildFallbackHeaders(cookieStr, pid);

  if (tokenHeaders) {

    try {

      const tokenTry = await requestPackageDetail(url, tokenHeaders);

      if (tokenTry.ok) {

        return {

          ok: true,

          data: tokenTry.json.data || {},

          via: 'token-only',

          status: tokenTry.res.status,

        };

      }

      if (!isAuthOrSignFailure(tokenTry.res.status, tokenTry.json, tokenTry.text)) {

        return {

          ok: false,

          status: tokenTry.res.status,

          error: tokenTry.json?.msg || tokenTry.json?.message || tokenTry.text.slice(0, 200) || `HTTP ${tokenTry.res.status}`,

          via: 'token-only',

        };

      }

    } catch (err) {

      /* fall through to signed request */

    }

  }



  const signed = buildSignedHeaders(shopConfig, url, pid);

  if (!signed?.headers) {

    return {

      ok: false,

      error: signed?.error?.message || 'headers_build_failed',

      via: tokenHeaders ? 'token-only-then-sign-fail' : 'no-token-no-sign',

    };

  }



  try {

    const signedTry = await requestPackageDetail(url, signed.headers);

    if (signedTry.ok) {

      return {

        ok: true,

        data: signedTry.json.data || {},

        via: signed.via,

        status: signedTry.res.status,

      };

    }

    return {

      ok: false,

      status: signedTry.res.status,

      error: signedTry.json?.msg || signedTry.json?.message || signedTry.text.slice(0, 200) || `HTTP ${signedTry.res.status}`,

      via: signed.via,

    };

  } catch (err) {

    return { ok: false, error: String(err.message || err), via: signed.via };

  }

}



module.exports = {

  fetchPackageDetailByCookie,

  buildFallbackHeaders,

};


import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isIP } from 'node:net';
import { createRecommendationService, CapacityError } from './recommend.mjs';
import { createAIProvider } from './provider.mjs';
import { ValidationError } from './validation.mjs';
import { createLearningService, LearningError } from './learning.mjs';
import { createGenerationGate } from './generation-gate.mjs';
import { createMapClassificationService, MapClassificationError } from './map-classification.mjs';
import { createMapAccess } from './map-access.mjs';
import { createStudyRouter } from './study/router.mjs';
import { createStudyService } from './study/service.mjs';
import { createStudyProvider } from './study/provider.mjs';
import { loadStudySources } from './study/catalogue.mjs';
import { createFirebaseStudyAccounts } from './study/accounts.mjs';
import { createStudyClassificationService } from './study/classification.mjs';
import { StudyError, requireStudy } from './study/source.mjs';
import { writeStudyDiagnostic } from './study/diagnostics.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.zip': 'application/zip',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://i.ytimg.com https://img.youtube.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
};
const LEGACY_AI_ROUTES = new Set(['/api/learning/generate','/api/recommendations','/api/map/classify']);
const DNS_HOST = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

function securityHeadersFor(accounts) {
  const config = accounts?.config();
  if (!config?.enabled) return SECURITY_HEADERS;
  const domain = config.firebase?.authDomain;
  requireStudy(typeof domain === 'string' && DNS_HOST.test(domain) && !isIP(domain), 'firebase_configuration_invalid', 503);
  return { ...SECURITY_HEADERS, 'content-security-policy': SECURITY_HEADERS['content-security-policy']
    .replace("script-src 'self';", "script-src 'self' https://apis.google.com;")
    .replace('frame-src https://www.youtube.com https://www.youtube-nocookie.com;', `frame-src https://www.youtube.com https://www.youtube-nocookie.com https://${domain};`)
    .replace("connect-src 'self';", "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com;") };
}

function originsFrom(value = '') {
  return new Set(value.split(',').map((value) => value.trim()).filter((value) => {
    if (EXTENSION_ORIGIN.test(value)) return true;
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && url.origin === value; } catch { return false; }
  }));
}
function readBody(request, maxBytes, raw = false) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const cleanup = () => { request.off('data', data); request.off('end', end); request.off('error', error); request.off('aborted', aborted); };
    const data = (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        cleanup(); request.resume();
        const failure = new Error('body_too_large'); failure.status = 413; reject(failure);
      } else chunks.push(chunk);
    };
    const end = () => { cleanup(); resolve(raw ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8')); };
    const error = () => { cleanup(); reject(new Error('invalid_body')); };
    const aborted = () => { cleanup(); reject(new Error('invalid_body')); };
    request.on('data', data); request.on('end', end); request.on('error', error); request.on('aborted', aborted);
  });
}
const boundedNumber = (value, fallback, min, max) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};

export function createHandler({ service = createRecommendationService(), learningService = createLearningService(), studyService = null, distDir = path.join(ROOT, 'dist'),
  mapService = createMapClassificationService(), mapAccess = createMapAccess(),
  studyAccounts = null, studyBilling = studyAccounts?.billing || null, studyEntitlements = studyAccounts?.entitlements || null, classificationService = null, studyAccessMode = studyService?.access?.mode || 'local',
  allowedOrigins = '', allowChromeExtensions = false, now = Date.now, maxBodyBytes = 16384,
  requestsPerMinute = 30, onDiagnostic = writeStudyDiagnostic } = {}) {
  const origins = allowedOrigins instanceof Set ? allowedOrigins : originsFrom(allowedOrigins);
  const rates = new Map();
  const studyRouter = createStudyRouter(studyService, { accounts: studyAccounts, entitlements: studyEntitlements, billing: studyBilling, classificationService, onDiagnostic });
  const securityHeaders = securityHeadersFor(studyAccounts);
  const authEnabled = studyAccounts?.config()?.enabled === true;
  function originAllowed(origin, request) {
    if (!origin) return true; // CORS is not authentication; CLI requests remain public.
    if (origins.has(origin) || allowChromeExtensions && EXTENSION_ORIGIN.test(origin)) return true;
    try {
      const url = new URL(origin);
      return ['https:', 'http:'].includes(url.protocol) && url.origin === origin && url.host === request.headers.host;
    } catch { return false; }
  }
  function rateAllowed(request) {
    const key = request.socket.remoteAddress || 'unknown'; // Never trust caller-supplied X-Forwarded-For.
    const current = now();
    if (rates.size >= 500) for (const [id, entry] of rates) if (current - entry.start >= 60000) rates.delete(id);
    const entry = rates.get(key);
    if (!entry && rates.size >= 500) return false;
    if (!entry || current - entry.start >= 60000) { rates.set(key, { start: current, count: 1 }); return true; }
    return ++entry.count <= requestsPerMinute;
  }
  return async function handler(request, response) {
    for (const [name, value] of Object.entries(securityHeaders)) response.setHeader(name, value);
    const json = (status, body, extra = {}) => {
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
      response.end(JSON.stringify(body));
    };
    let url;
    try { url = new URL(request.url, 'http://server.invalid'); } catch { return json(400, { error: 'invalid_request', message: '無效網址' }); }
    if(url.pathname==='/api/billing/stripe-webhook'){
      if(request.method!=='POST')return json(405,{error:'method_not_allowed'},{allow:'POST'});
      if(!studyBilling)return json(503,{error:'payments_unavailable'});
      if(request.headers['content-type']?.split(';')[0]?.trim()!=='application/json')return json(415,{error:'unsupported_media_type'});
      try{return json(200,await studyBilling.webhook(await readBody(request,262144,true),request.headers['stripe-signature']));}
      catch(error){const invalid=error instanceof StudyError&&['invalid_payment_signature','payment_mismatch'].includes(error.code);return json(error.status===413?413:invalid?400:503,{error:error.status===413?'body_too_large':invalid?error.code:'payment_event_unavailable'});}
    }
    if (url.pathname.startsWith('/api/')) {
      const origin = request.headers.origin;
      if (!originAllowed(origin, request)) return json(403, { error: 'origin_not_allowed', message: '未允許此網頁或 extension 來源' });
      if (origin) { response.setHeader('access-control-allow-origin', origin); response.setHeader('vary', 'Origin'); }
      if (request.method === 'OPTIONS') {
        response.writeHead(204, { 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': `Content-Type, X-Delta-Map-Token${authEnabled ? ', Authorization' : ''}`, 'access-control-max-age': '600' });
        return response.end();
      }
      if (studyAccessMode === 'google' && LEGACY_AI_ROUTES.has(url.pathname)) {
        return json(409, { error: 'study_account_route_required', message: 'Open the signed-in Learning lab to use your personal AI credit.' });
      }
      if (url.pathname === '/api/health' && request.method === 'GET') return json(200, { ok: true, version: '0.7.0', analysis: service.readiness ? await service.readiness() : service.health(), learning: learningService.readiness(), map: { ...mapService.readiness(), privateAccess: mapAccess.configured } });
      if (await studyRouter({request,response,url,json,readBody,rateAllowed})) return;
      if (url.pathname === '/api/map/classify') {
        if (request.method !== 'POST') return json(405,{error:'method_not_allowed',message:'Please use POST.'},{allow:'POST, OPTIONS'});
        if (!mapAccess.accepts(request.headers['x-delta-map-token'])) return json(403,{error:'map_access_required',message:'Connect your private map analysis access first.'});
        if (!rateAllowed(request)) return json(429,{error:'rate_limited',message:'Map analysis is paused. Please try again shortly.'},{'retry-after':'60'});
        if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') return json(415,{error:'unsupported_media_type',message:'Please use JSON.'});
        try {
          let input;try{input=JSON.parse(await readBody(request,512000));}catch(error){if(error.status===413)throw error;return json(400,{error:'invalid_request',message:'Invalid JSON.'});}
          return json(200,await mapService.classify(input));
        } catch(error) {
          if(error instanceof MapClassificationError){const retry=Number.isFinite(error.retryAfterSeconds)?Math.max(1,Math.ceil(error.retryAfterSeconds)):null;return json(error.status||503,{error:error.code,message:error.message,...(retry?{retryAfterSeconds:retry}:{})},retry?{'retry-after':String(retry)}:{});}
          if(error.status===413)return json(413,{error:'body_too_large',message:'Map request is too large.'});
          return json(503,{error:'map_unavailable',message:'Map analysis is unavailable. Your saved records are kept.'});
        }
      }
      const learningAction = /^\/api\/learning\/(generate|validate|reteach|pptx)$/.exec(url.pathname)?.[1];
      if (learningAction) {
        if (request.method !== 'POST') return json(405, { error: 'method_not_allowed', message: 'Please use POST.' }, { allow: 'POST, OPTIONS' });
        if (!rateAllowed(request)) return json(429, { error: 'rate_limited', message: 'Too many requests. Try again shortly.' }, { 'retry-after': '60' });
        if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') return json(415, { error: 'unsupported_media_type', message: 'Please use JSON.' });
        try {
          const raw = await readBody(request, 65536);
          let input;
          try { input = JSON.parse(raw); } catch { return json(400, { error: 'invalid_request', message: 'Invalid JSON.' }); }
          if (learningAction === 'pptx') {
            const result = await learningService.exportPptx(input);
            response.writeHead(200, { 'content-type': result.contentType, 'content-length': result.buffer.length,
              'cache-control': 'no-store', 'content-disposition': `attachment; filename="${result.filename}"` });
            return response.end(result.buffer);
          }
          return json(200, await learningService[learningAction](input));
        } catch (error) {
          if (error instanceof LearningError) {
            const cooldown = error.status === 429 && Number.isFinite(error.retryAfterSeconds) && error.retryAfterSeconds > 0
              ? { 'retry-after': String(Math.min(86400, Math.ceil(error.retryAfterSeconds))) } : {};
            return json(error.status || 400, { error: error.code, message: error.message }, cooldown);
          }
          if (error.status === 413) return json(413, { error: 'body_too_large', message: 'Learning request is too large.' });
          return json(500, { error: 'learning_unavailable', message: 'The lesson could not be completed. Your saved work is unchanged.' });
        }
      }
      if (url.pathname !== '/api/recommendations') return json(404, { error: 'not_found', message: '找不到 API' });
      if (request.method !== 'POST') return json(405, { error: 'method_not_allowed', message: '請用 POST' }, { allow: 'POST, OPTIONS' });
      if (!rateAllowed(request)) return json(429, { error: 'rate_limited', message: '要求太頻密，請稍後再試' }, { 'retry-after': '60' });
      if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') return json(415, { error: 'unsupported_media_type', message: '請使用 JSON' });
      try {
        const body = await readBody(request, maxBodyBytes);
        let input;
        try { input = JSON.parse(body); } catch { throw new ValidationError('無效 JSON'); }
        return json(200, await service.recommend(input));
      } catch (error) {
        if (error instanceof ValidationError) return json(400, { error: 'invalid_request', message: error.message });
        if (error instanceof CapacityError) return json(429, { error: 'rate_limited', message: error.code === 'analysis_busy' ? '分析服務忙碌，請稍後再試' : '今個鐘分析配額已用完，請稍後再試' }, { 'retry-after': error.code === 'analysis_busy' ? '45' : '3600' });
        if (error.status === 413) return json(413, { error: 'body_too_large', message: '要求資料超出大小限制' });
        return json(500, { error: 'analysis_unavailable', message: '分析暫時未能完成，觀看紀錄不受影響' });
      }
    }
    if (!['GET', 'HEAD'].includes(request.method)) return json(405, { error: 'method_not_allowed', message: '請用 GET' });
    try {
      const decoded = decodeURIComponent(url.pathname);
      if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some((part) => part.startsWith('.'))) return json(404, { error: 'not_found', message: '找不到頁面' });
      const root = await realpath(distDir);
      let target = path.resolve(root, `.${decoded}`);
      if (target !== root && !target.startsWith(`${root}${path.sep}`)) return json(404, { error: 'not_found', message: '找不到頁面' });
      if (['/', '/prototype', '/prototype/', '/learn', '/learn/', '/assistant', '/assistant/'].includes(decoded)) target = path.join(root, 'index.html');
      const resolved = await realpath(target);
      if (!resolved.startsWith(`${root}${path.sep}`) || !(await stat(resolved)).isFile()) return json(404, { error: 'not_found', message: '找不到頁面' });
      const type = MIME[path.extname(resolved).toLowerCase()];
      if (!type) return json(404, { error: 'not_found', message: '找不到頁面' });
      const body = await readFile(resolved);
      response.writeHead(200, { 'content-type': type, 'content-length': body.length,
        'cache-control': path.extname(resolved) === '.html' ? 'no-cache' : 'public, max-age=3600' });
      return response.end(request.method === 'HEAD' ? undefined : body);
    } catch { return json(404, { error: 'not_found', message: '找不到頁面' }); }
  };
}

export function createServer(options = {}) {
  const handler = createHandler(options);
  const server = http.createServer((request, response) => { handler(request, response).catch(() => { if (!response.headersSent) response.writeHead(500); response.end(); }); });
  server.requestTimeout = 120000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return server;
}

export function startServer({ env = process.env, studyAccounts = null } = {}) {
  const generationGate = createGenerationGate({ env });
  const provider = createAIProvider({ env, generationGate });
  const service = createRecommendationService({ provider,
    maxAnalysesPerHour: boundedNumber(env.MAX_ANALYSES_PER_HOUR, 12, 1, 120),
    maxConcurrent: boundedNumber(env.MAX_CONCURRENT_ANALYSES, 2, 1, 4), indexDirectory: env.TRANSCRIPT_INDEX_DIR || '',
    requireReviewedIndex: provider.transport === 'vertex' });
  const learningService = createLearningService({ env, generationGate });
  const mapService = createMapClassificationService({ env, generationGate });
  const mapAccess = createMapAccess({ env });
  const studyProvider = createStudyProvider({env,generationGate});
  const studyService = env.STUDY_ENABLED === 'true' ? createStudyService({env,
    directory:env.STUDY_CACHE_DIR||path.join(ROOT,'artifacts/study/cache'),sources:loadStudySources(env.STUDY_SOURCE_DIR||path.join(ROOT,'artifacts/study/sources')),
    userQuota:studyAccounts,paidUsage:studyAccounts?.paidUsage,
    provider:studyProvider}) : null;
  const classificationService = studyService && env.STUDY_ACCESS_MODE === 'google'
    ? createStudyClassificationService({provider:studyProvider,accounts:studyAccounts,paidAccounts:studyAccounts?.paidUsage,env}) : null;
  const server = createServer({ service, learningService, studyService, studyAccounts, classificationService, studyAccessMode:env.STUDY_ACCESS_MODE??'local', mapService, mapAccess, allowedOrigins: env.ALLOWED_ORIGINS || '',
    allowChromeExtensions: env.ALLOW_CHROME_EXTENSIONS === 'true', distDir: path.join(ROOT, 'dist') });
  const port = boundedNumber(env.PORT, 8787, 1, 65535);
  const host = env.HOST || '127.0.0.1';
  server.listen(port, host, () => process.stdout.write(`Delta HTTP service listening on ${host}:${port}; AI configured: ${provider.configured}\n`));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const studyAccounts = process.env.STUDY_ENABLED === 'true' && process.env.STUDY_ACCESS_MODE === 'google'
      ? await createFirebaseStudyAccounts({ env: process.env }) : null;
    startServer({ studyAccounts });
  } catch (error) {
    process.stderr.write(`Delta startup failed: ${error instanceof StudyError ? error.code : 'configuration_invalid'}\n`);
    process.exitCode = 1;
  }
}

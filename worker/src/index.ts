import { createClient } from '@supabase/supabase-js';
import {
  S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand,
  CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET: string;
  CORS_ORIGIN: string;
  MAX_FAMILY_BYTES: string;
}
type Member = { family_id: string; user_id: string; role: string; status: string };
type Context = { db: ReturnType<typeof createClient<any, 'public'>>; user: { id: string; email?: string; email_confirmed_at?: string }; member: Member | null; s3: S3Client; env: Env };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PHOTO = 25 * 1024 * 1024;
const MAX_VIDEO = 500 * 1024 * 1024;
const PART_SIZE = 10 * 1024 * 1024;
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
function assert(condition: unknown, status: number, message: string): asserts condition {
  if (!condition) throw new HttpError(status, message);
}
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
function text(v: unknown, max = 200): string { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
function id(v: unknown): string { assert(typeof v === 'string' && uuid.test(v), 400, '유효하지 않은 식별자입니다.'); return v; }
async function payload(req: Request): Promise<Record<string, any>> {
  try {
    const data: unknown = await req.json();
    assert(!!data && typeof data === 'object' && !Array.isArray(data), 400, '올바른 요청 형식이 아닙니다.');
    return data as Record<string, any>;
  } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, 'JSON 본문이 필요합니다.'); }
}
function canUpload(m: Member | null): boolean { return !!m && ['owner','admin','contributor'].includes(m.role); }
function canManage(m: Member | null): boolean { return !!m && ['owner','admin'].includes(m.role); }
function requireMember(c: Context): Member { assert(c.member, 403, '가족 초대가 필요한 계정입니다.'); return c.member; }
function requireUpload(c: Context): Member { assert(canUpload(c.member), 403, '업로드 권한이 없습니다.'); return c.member!; }
function requireManage(c: Context): Member { assert(canManage(c.member), 403, '관리 권한이 없습니다.'); return c.member!; }
function s3Client(env: Env): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: 'https://' + env.R2_ACCOUNT_ID + '.r2.cloudflarestorage.com',
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY }
  });
}
function cors(req: Request, env: Env): Headers {
  const origin = req.headers.get('Origin');
  const allowed = origin === env.CORS_ORIGIN || origin === 'http://localhost:5173';
  const h = new Headers({
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff'
  });
  if (origin && allowed) h.set('Access-Control-Allow-Origin', origin);
  return h;
}
async function mediaRow(c: Context, mediaId: string) {
  const m = requireMember(c);
  const { data, error } = await c.db.from('media').select('*').eq('id', id(mediaId)).eq('family_id', m.family_id).maybeSingle();
  assert(!error && data, 404, '파일을 찾을 수 없습니다.');
  return data;
}
function isAuthorOrAdmin(c: Context, row: any) {
  assert(canManage(c.member) || (canUpload(c.member) && row.uploaded_by === c.user.id), 403, '수정 권한이 없습니다.');
}
async function audit(c: Context, action: string, resourceId?: string) {
  if (c.member) await c.db.from('audit_logs').insert({ family_id: c.member.family_id, actor_id: c.user.id, action, resource_id: resourceId || null });
}
async function sha256(s: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b), n => n.toString(16).padStart(2, '0')).join('');
}
function token(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === '/api/health' && req.method === 'GET') return json({ status: 'ok' });
  const auth = req.headers.get('Authorization') || '';
  assert(auth.startsWith('Bearer '), 401, '로그인이 필요합니다.');
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authErr } = await db.auth.getUser(auth.slice(7));
  assert(!authErr && authData.user, 401, '로그인이 만료되었습니다.');
  const user = authData.user;
  const { data: membership, error: memberError } = await db.from('family_members')
    .select('family_id,user_id,role,status').eq('user_id', user.id).eq('status', 'active').order('joined_at').limit(1).maybeSingle();
  assert(!memberError, 500, '구성원을 조회하지 못했습니다.');
  const c: Context = { db, user, member: membership || null, s3: s3Client(env), env };
  const path = url.pathname;
  const method = req.method;

  if (path === '/api/me' && method === 'GET') {
    if (!c.member) return json({ user: { id: user.id, email: user.email }, family: null, role: null });
    const { data: family } = await db.from('families').select('id,name').eq('id', c.member.family_id).single();
    return json({ user: { id: user.id, email: user.email }, family, role: c.member.role });
  }
  if (path === '/api/invitations/accept' && method === 'POST') {
    assert(user.email && user.email_confirmed_at, 403, '이메일 인증을 완료해야 합니다.');
    const b = await payload(req);
    const code = text(b.token, 200);
    assert(code.length >= 32, 400, '유효하지 않은 초대 코드입니다.');
    const hash = await sha256(code);
    const { error: acceptError } = await db.rpc('accept_family_invite', {
      p_hash: hash, p_actor: user.id
    });
    assert(!acceptError, 409, '초대가 만료되었거나 이메일이 일치하지 않습니다.');
    return json({ ok: true });
  }

  const member = requireMember(c);
  if (path === '/api/albums' && method === 'GET') {
    const { data, error } = await db.from('albums').select('*').eq('family_id', member.family_id).order('event_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false });
    assert(!error, 500, '앨범을 불러오지 못했습니다.');
    return json({ albums: data });
  }
  if (path === '/api/albums' && method === 'POST') {
    requireUpload(c);
    const b = await payload(req);
    const title = text(b.title, 150);
    assert(title.length > 0, 400, '앨범 이름을 입력하세요.');
    const { data, error } = await db.from('albums').insert({
      family_id: member.family_id, created_by: user.id,
      title, description: text(b.description, 1000), event_date: b.eventDate || null
    }).select('*').single();
    assert(!error && data, 500, '앨범 생성에 실패했습니다.');
    await audit(c, 'album.create', data.id);
    return json({ album: data }, 201);
  }
  const albumPath = path.match(/^\/api\/albums\/([^/]+)$/);
  if (albumPath && (method === 'PATCH' || method === 'DELETE')) {
    const { data: album } = await db.from('albums').select('*').eq('id', id(albumPath[1])).eq('family_id', member.family_id).maybeSingle();
    assert(album, 404, '앨범을 찾을 수 없습니다.');
    assert(canManage(member) || (canUpload(member) && album.created_by === user.id), 403, '앨범 수정 권한이 없습니다.');
    if (method === 'DELETE') {
      const { count } = await db.from('media').select('id', { count: 'exact', head: true }).eq('album_id', album.id);
      assert(!count, 409, '사진이나 영상이 남아 있는 앨범은 삭제할 수 없습니다.');
      const { error } = await db.from('albums').delete().eq('id', album.id);
      assert(!error, 500, '앨범 삭제에 실패했습니다.');
      return json({ ok: true });
    }
    const b = await payload(req);
    assert(text(b.title, 150).length > 0, 400, '앨범 이름이 필요합니다.');
    const { data, error } = await db.from('albums').update({
      title: text(b.title, 150), description: text(b.description, 1000), event_date: b.eventDate || null
    }).eq('id', album.id).select('*').single();
    assert(!error && data, 500, '앨범 수정에 실패했습니다.');
    return json({ album: data });
  }
  if (path === '/api/media' && method === 'GET') {
    const albumId = url.searchParams.get('album');
    let q = db.from('media').select('id,album_id,family_id,uploaded_by,media_type,mime_type,original_filename,thumbnail_key,size_bytes,captured_at,created_at,status')
      .eq('family_id', member.family_id).eq('status', 'ready');
    if (albumId) q = q.eq('album_id', id(albumId));
    const keyword = (url.searchParams.get('q') || '').slice(0, 60).replace(/[%_,]/g, '');
    if (keyword) q = q.ilike('original_filename', '%' + keyword + '%');
    const { data, error } = await q.order('captured_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(200);
    assert(!error, 500, '파일을 불러오지 못했습니다.');
    return json({ media: data });
  }
  if (path === '/api/trash' && method === 'GET') {
    const { data, error } = await db.from('media').select('id,album_id,original_filename,media_type,deleted_at')
      .eq('family_id', member.family_id).eq('status', 'deleted').order('deleted_at', { ascending: false }).limit(100);
    assert(!error, 500, '휴지통을 조회하지 못했습니다.');
    return json({ media: data });
  }
  if (path === '/api/storage/usage' && method === 'GET') {
    const { data, error } = await db.from('media').select('size_bytes,status').eq('family_id', member.family_id);
    assert(!error, 500, '용량을 조회하지 못했습니다.');
    const used = (data || []).filter(r => ['pending','uploading','ready','deleted'].includes(r.status))
      .reduce((sum, r) => sum + Number(r.size_bytes), 0);
    return json({ usedBytes: used, maxBytes: Number(env.MAX_FAMILY_BYTES) });
  }
  if (path === '/api/family/members' && method === 'GET') {
    const { data, error } = await db.from('family_members').select('user_id,role,status,joined_at')
      .eq('family_id', member.family_id).order('joined_at');
    assert(!error, 500, '가족 목록을 조회하지 못했습니다.');
    const members = await Promise.all((data || []).map(async m => {
      const { data: au } = await db.auth.admin.getUserById(m.user_id);
      return { ...m, email: au.user?.email || '비공개 계정' };
    }));
    return json({ members });
  }
  if (path === '/api/invitations' && method === 'POST') {
    requireManage(c);
    const b = await payload(req);
    const email = text(b.email, 200).toLowerCase();
    const role = text(b.role, 20) || 'viewer';
    assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 400, '올바른 이메일을 입력하세요.');
    assert(['admin','contributor','viewer'].includes(role), 400, '잘못된 역할입니다.');
    assert(role !== 'admin' || member.role === 'owner', 403, '관리자는 소유자만 지정할 수 있습니다.');
    const code = token();
    const { error } = await db.from('invitations').insert({
      family_id: member.family_id, email, role, token_hash: await sha256(code),
      created_by: user.id, expires_at: new Date(Date.now() + 7*86400*1000).toISOString()
    });
    assert(!error, 500, '초대 생성에 실패했습니다.');
    await audit(c, 'family.invite');
    return json({ inviteUrl: env.CORS_ORIGIN + '/?invite=' + code, expiresInDays: 7 }, 201);
  }
  const memberPath = path.match(/^\/api\/members\/([^/]+)$/);
  if (memberPath && method === 'PATCH') {
    requireManage(c);
    const targetId = id(memberPath[1]);
    const { data: target } = await db.from('family_members').select('*').eq('family_id', member.family_id).eq('user_id', targetId).maybeSingle();
    assert(target, 404, '구성원을 찾을 수 없습니다.');
    assert(target.role !== 'owner', 403, '소유자 권한은 변경할 수 없습니다.');
    assert(member.role === 'owner' || target.role !== 'admin', 403, '관리자 변경은 소유자만 가능합니다.');
    const b = await payload(req);
    const role = text(b.role, 20) || target.role;
    const status = text(b.status, 20) || target.status;
    assert(['admin','contributor','viewer'].includes(role), 400, '허용되지 않는 역할입니다.');
    assert(member.role === 'owner' || role !== 'admin', 403, '관리자는 소유자만 지정할 수 있습니다.');
    assert(['active','suspended'].includes(status), 400, '허용되지 않는 상태입니다.');
    const { error } = await db.from('family_members').update({ role, status }).eq('family_id', member.family_id).eq('user_id', targetId);
    assert(!error, 500, '변경하지 못했습니다.');
    await audit(c, 'member.update', targetId);
    return json({ ok: true });
  }
  if (path === '/api/media/init' && method === 'POST') {
    requireUpload(c);
    const b = await payload(req);
    const albumId = id(b.albumId);
    const kind = text(b.kind, 10);
    const mime = text(b.mimeType, 60).toLowerCase();
    const bytes = Number(b.sizeBytes);
    assert(kind === 'image' || kind === 'video', 400, '지원하지 않는 파일 종류입니다.');
    assert(kind === 'image' ? ['image/jpeg','image/png','image/webp'].includes(mime) : mime === 'video/mp4', 415, '현재 JPEG, PNG, WebP, MP4(H.264)만 지원합니다.');
    assert(Number.isSafeInteger(bytes) && bytes > 0 && bytes <= (kind === 'image' ? MAX_PHOTO : MAX_VIDEO), 413, '파일 크기 제한을 초과했습니다.');
    const { data: row, error } = await db.rpc('reserve_media_upload', {
      p_family: member.family_id, p_album: albumId, p_actor: user.id, p_kind: kind, p_mime: mime,
      p_filename: text(b.filename, 250) || 'untitled', p_bytes: bytes,
      p_captured: b.capturedAt || null, p_max: Number(env.MAX_FAMILY_BYTES)
    });
    assert(!error && row, 409, '앨범 권한 또는 저장 공간을 확인하세요.');
    try {
      if (bytes < 100 * 1024 * 1024) {
        const uploadUrl = await getSignedUrl(c.s3, new PutObjectCommand({
          Bucket: env.R2_BUCKET, Key: row.storage_key, ContentType: mime
        }), { expiresIn: 120 });
        await db.from('media').update({ status: 'uploading' }).eq('id', row.id);
        return json({ mediaId: row.id, method: 'single', uploadUrl }, 201);
      }
      const created = await c.s3.send(new CreateMultipartUploadCommand({
        Bucket: env.R2_BUCKET, Key: row.storage_key, ContentType: mime
      }));
      assert(created.UploadId, 500, '분할 업로드를 시작하지 못했습니다.');
      await db.from('media').update({ status: 'uploading', upload_id: created.UploadId }).eq('id', row.id);
      return json({ mediaId: row.id, method: 'multipart', partSize: PART_SIZE }, 201);
    } catch {
      await db.from('media').update({ status: 'failed' }).eq('id', row.id);
      throw new HttpError(502, '파일 저장소 연결에 실패했습니다.');
    }
  }
  const mediaPath = path.match(/^\/api\/media\/([^/]+)(?:\/(access|part|complete|abort|thumbnail|thumbnail-complete|restore))?$/);
  if (mediaPath) {
    const row = await mediaRow(c, mediaPath[1]);
    const op = mediaPath[2] || '';
    if (op === 'access' && method === 'GET') {
      assert(row.status === 'ready', 404, '열람할 수 없는 파일입니다.');
      const variant = url.searchParams.get('variant') || 'original';
      const key = variant === 'thumbnail' && row.thumbnail_key ? row.thumbnail_key : row.storage_key;
      const signedUrl = await getSignedUrl(c.s3, new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }), { expiresIn: variant === 'thumbnail' ? 600 : 600 });
      return json({ url: signedUrl, expiresIn: 600 });
    }
    if (op === 'part' && method === 'POST') {
      isAuthorOrAdmin(c, row);
      assert(row.status === 'uploading' && row.upload_id, 409, '분할 업로드 세션이 없습니다.');
      const b = await payload(req);
      const part = Number(b.partNumber);
      assert(Number.isInteger(part) && part > 0 && part <= Math.ceil(row.size_bytes/PART_SIZE), 400, '잘못된 분할 번호입니다.');
      const signedUrl = await getSignedUrl(c.s3, new UploadPartCommand({
        Bucket: env.R2_BUCKET, Key: row.storage_key, UploadId: row.upload_id, PartNumber: part
      }), { expiresIn: 300 });
      return json({ uploadUrl: signedUrl });
    }
    if (op === 'complete' && method === 'POST') {
      isAuthorOrAdmin(c, row);
      assert(row.status === 'uploading', 409, '진행 중인 업로드가 아닙니다.');
      const b = await payload(req);
      if (row.upload_id) {
        const parts: { ETag: string; PartNumber: number }[] = Array.isArray(b.parts) ? b.parts : [];
        const expected = Math.ceil(row.size_bytes/PART_SIZE);
        assert(parts.length === expected, 400, '업로드 조각이 누락되었습니다.');
        for (let i=0;i<parts.length;i++) assert(parts[i].PartNumber === i+1 && typeof parts[i].ETag === 'string' && !!parts[i].ETag, 400, '잘못된 업로드 조각입니다.');
        await c.s3.send(new CompleteMultipartUploadCommand({
          Bucket: env.R2_BUCKET, Key: row.storage_key, UploadId: row.upload_id, MultipartUpload: { Parts: parts }
        }));
      }
      const head = await c.s3.send(new HeadObjectCommand({ Bucket: env.R2_BUCKET, Key: row.storage_key }));
      if (Number(head.ContentLength) !== Number(row.size_bytes) || head.ContentType !== row.mime_type) {
        await c.s3.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: row.storage_key }));
        await db.from('media').update({ status: 'failed', upload_id: null }).eq('id', row.id);
        throw new HttpError(422, '파일 크기 또는 형식 확인에 실패했습니다.');
      }
      await db.from('media').update({ status: 'ready', upload_id: null }).eq('id', row.id);
      await audit(c, 'media.upload', row.id);
      return json({ ok: true });
    }
    if (op === 'abort' && method === 'POST') {
      isAuthorOrAdmin(c, row);
      if (row.upload_id) await c.s3.send(new AbortMultipartUploadCommand({
        Bucket: env.R2_BUCKET, Key: row.storage_key, UploadId: row.upload_id
      }));
      await db.from('media').update({ status: 'failed', upload_id: null }).eq('id', row.id);
      return json({ ok: true });
    }
    if (op === 'thumbnail' && method === 'POST') {
      isAuthorOrAdmin(c, row);
      assert(row.status === 'ready', 409, '원본 업로드가 완료되지 않았습니다.');
      const key = 'families/' + member.family_id + '/thumbnails/' + row.id + '.webp';
      const uploadUrl = await getSignedUrl(c.s3, new PutObjectCommand({
        Bucket: env.R2_BUCKET, Key: key, ContentType: 'image/webp'
      }), { expiresIn: 120 });
      return json({ uploadUrl });
    }
    if (op === 'thumbnail-complete' && method === 'POST') {
      isAuthorOrAdmin(c, row);
      const key = 'families/' + member.family_id + '/thumbnails/' + row.id + '.webp';
      const head = await c.s3.send(new HeadObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
      assert(Number(head.ContentLength) > 0 && Number(head.ContentLength) < 1024*1024 && head.ContentType === 'image/webp', 422, '썸네일 검증에 실패했습니다.');
      await db.from('media').update({ thumbnail_key: key }).eq('id', row.id);
      return json({ ok: true });
    }
    if (op === 'restore' && method === 'POST') {
      isAuthorOrAdmin(c, row);
      assert(row.status === 'deleted', 409, '휴지통에 있는 파일이 아닙니다.');
      await db.from('media').update({ status: 'ready', deleted_at: null }).eq('id', row.id);
      return json({ ok: true });
    }
    if (!op && method === 'DELETE') {
      isAuthorOrAdmin(c, row);
      assert(row.status === 'ready', 409, '완료된 파일만 휴지통으로 이동할 수 있습니다.');
      await db.from('media').update({ status: 'deleted', deleted_at: new Date().toISOString() }).eq('id', row.id);
      await audit(c, 'media.trash', row.id);
      return json({ ok: true });
    }
  }
  return json({ error: '존재하지 않는 API입니다.' }, 404);
}
// Daily cleanup: reclaim abandoned uploads after 24h and trash after 30 days.
// Only objects whose DB rows still satisfy the retention condition are processed.
async function cleanup(env: Env): Promise<void> {
  const db = createClient(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY,
    {auth:{persistSession:false,autoRefreshToken:false}});
  const s3 = s3Client(env);
  const abandoned = new Date(Date.now()-24*60*60*1000).toISOString();
  const expired = new Date(Date.now()-30*24*60*60*1000).toISOString();
  const {data: stale} = await db.from('media').select('*')
    .in('status',['pending','uploading','failed']).lt('created_at',abandoned).limit(100);
  for(const row of stale || []) {
    try {
      if(row.upload_id) await s3.send(new AbortMultipartUploadCommand({
        Bucket:env.R2_BUCKET,Key:row.storage_key,UploadId:row.upload_id
      }));
      await s3.send(new DeleteObjectCommand({Bucket:env.R2_BUCKET,Key:row.storage_key}));
      await db.from('media').delete().eq('id',row.id).in('status',['pending','uploading','failed']).lt('created_at',abandoned);
    } catch { /* Retry on next cron; never log filenames or signed URLs. */ }
  }
  const {data: trash} = await db.from('media').select('*').eq('status','deleted')
    .lt('deleted_at',expired).limit(100);
  for(const row of trash || []) {
    try {
      // Avoid removing an object just restored by a user.
      const {data: current} = await db.from('media').select('status,deleted_at').eq('id',row.id).maybeSingle();
      if(current?.status!=='deleted' || !current.deleted_at || current.deleted_at>=expired) continue;
      await s3.send(new DeleteObjectCommand({Bucket:env.R2_BUCKET,Key:row.storage_key}));
      if(row.thumbnail_key) await s3.send(new DeleteObjectCommand({Bucket:env.R2_BUCKET,Key:row.thumbnail_key}));
      await db.from('comments').delete().eq('media_id',row.id);
      await db.from('media').delete().eq('id',row.id).eq('status','deleted').lt('deleted_at',expired);
    } catch { /* Retry on next cron. */ }
  }
}
export default {
  async scheduled(_event: unknown, env: Env): Promise<void> { await cleanup(env); },
  async fetch(req: Request, env: Env): Promise<Response> {
    const headers = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const origin = req.headers.get('Origin');
    if (origin && origin !== env.CORS_ORIGIN && origin !== 'http://localhost:5173') return json({ error: '허용되지 않는 출처입니다.' }, 403);
    try {
      const response = await handle(req, env);
      for (const [k,v] of headers.entries()) response.headers.set(k,v);
      return response;
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof HttpError ? err.message : '서버 요청을 처리하지 못했습니다.';
      const response = json({ error: message }, status);
      for (const [k,v] of headers.entries()) response.headers.set(k,v);
      return response;
    }
  }
};

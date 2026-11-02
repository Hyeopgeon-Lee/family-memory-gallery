import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient, type Session } from '@supabase/supabase-js';
import {
  Heart, Home, Images, FolderHeart, UsersRound, Trash2, Plus, UploadCloud,
  Search, ArrowLeft, X, Play, Download, LogOut, Settings, CalendarDays,
  HardDrive, Copy, Check, ShieldCheck, ImageOff, RefreshCw, Film, Menu,
  ChevronRight, RotateCcw, Sparkles, Camera, LockKeyhole, Edit3
} from 'lucide-react';
import './style.css';

const URL_SUPA = import.meta.env.VITE_SUPABASE_URL || '';
const KEY_SUPA = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const API_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const configured = /^https:\/\//.test(URL_SUPA) && !!KEY_SUPA && /^https:\/\//.test(API_URL);
const supa = configured ? createClient(URL_SUPA, KEY_SUPA) : null;
const PRODUCTION_AUTH_CALLBACK_URL = 'https://family.k-bigdata.kr/';

/** Never use an incidental preview/localhost origin for production confirmation email links. */
function emailConfirmationRedirect(): string {
  const redirect = new URL(PRODUCTION_AUTH_CALLBACK_URL);
  const invite = new URLSearchParams(window.location.search).get('invite');
  if (invite && /^[a-zA-Z0-9_-]{32,256}$/.test(invite)) {
    redirect.searchParams.set('invite', invite);
  }
  return redirect.toString();
}


type Me = { user: { id: string; email: string }; family: { id: string; name: string } | null; role: 'owner'|'admin'|'contributor'|'viewer'|null };
type Album = { id: string; title: string; description: string; event_date: string|null; created_at: string; created_by: string };
type Media = { id: string; album_id: string; original_filename: string; mime_type: string; media_type: 'image'|'video'; captured_at: string|null; created_at: string; size_bytes: number; uploaded_by: string; thumbnail_key: string|null };
type FamilyMember = { user_id: string; email: string; role: string; status: string; joined_at: string };
type DeletedMedia = { id: string; original_filename: string; media_type: string; deleted_at: string };
type Tab = 'home'|'albums'|'trash'|'family';

async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  if (!supa) throw new Error('Supabase와 API 연결 설정이 필요합니다.');
  const { data: { session } } = await supa.auth.getSession();
  if (!session) throw new Error('로그인이 필요합니다.');
  const res = await fetch(API_URL + '/api' + path, {
    ...options,
    headers: { 'Authorization': 'Bearer ' + session.access_token,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || '요청을 처리하지 못했습니다.');
  return out as T;
}
function prettyDate(v: string | null | undefined): string {
  if (!v) return '날짜 미상';
  const date = new Date(v);
  return Number.isNaN(date.getTime()) ? v : new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'long',day:'numeric'}).format(date);
}
function bytes(v: number): string { return v >= 1024**3 ? (v/1024**3).toFixed(2)+'GB' : (v/1024**2).toFixed(1)+'MB'; }
function canWrite(role: Me['role']): boolean { return ['owner','admin','contributor'].includes(role || ''); }
function canAdmin(role: Me['role']): boolean { return role === 'owner' || role === 'admin'; }

async function thumbnail(file: File): Promise<Blob | null> {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    if (file.type.startsWith('image/')) {
      const bitmap = await createImageBitmap(file);
      const s = Math.min(1, 640 / Math.max(bitmap.width,bitmap.height));
      canvas.width = Math.max(1,Math.round(bitmap.width*s));
      canvas.height = Math.max(1,Math.round(bitmap.height*s));
      ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      bitmap.close();
    } else if (file.type === 'video/mp4') {
      const video = document.createElement('video');
      const src = URL.createObjectURL(file);
      try {
        video.preload = 'auto'; video.muted = true; video.src = src;
        await new Promise<void>((resolve,reject) => {
          video.onloadeddata = () => resolve();
          video.onerror = () => reject(new Error('동영상 미리보기 불가'));
          setTimeout(() => reject(new Error('미리보기 타임아웃')), 12000);
        });
        const s = Math.min(1,640 / Math.max(video.videoWidth,video.videoHeight));
        canvas.width = Math.max(1,Math.round(video.videoWidth*s));
        canvas.height = Math.max(1,Math.round(video.videoHeight*s));
        ctx.drawImage(video,0,0,canvas.width,canvas.height);
      } finally { URL.revokeObjectURL(src); video.removeAttribute('src'); video.load(); }
    } else return null;
    return await new Promise(resolve => canvas.toBlob(resolve,'image/webp',0.72));
  } catch { return null; }
}

function AuthScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [signup,setSignup] = useState(false);
  const [email,setEmail] = useState('');
  const [password,setPassword] = useState('');
  const [message,setMessage] = useState('');
  const [busy,setBusy] = useState(false);
  const [emailSent,setEmailSent] = useState(false);
  const resendConfirmation = async () => {
    if (!supa || !email.trim() || busy) return;
    setBusy(true); setMessage('');
    try {
      const {error} = await supa.auth.resend({type:'signup',email:email.trim(),options:{emailRedirectTo:emailConfirmationRedirect()}});
      if (error) throw error;
      setEmailSent(true);
      setMessage('인증 메일을 다시 보냈습니다. 새 메일의 링크를 확인해 주세요.');
    } catch (e) { setMessage(e instanceof Error ? e.message : '인증 메일을 다시 보내지 못했습니다.'); }
    finally { setBusy(false); }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if(!supa) return;
    setBusy(true);setMessage('');
    try {
      if (signup) {
        const {data,error} = await supa.auth.signUp({email,password,options:{emailRedirectTo:emailConfirmationRedirect()}});
        if(error) throw error;
        setEmailSent(!data.session);
        setMessage(data.session ? '가입했습니다. 가족 초대 링크를 사용해 주세요.' : '확인 메일을 보냈습니다. 이메일 인증 후 로그인해 주세요.');
        if(data.session) onSignedIn();
      } else {
        const {error} = await supa.auth.signInWithPassword({email,password});
        if(error) throw error;
        onSignedIn();
      }
    } catch(e) {setMessage(e instanceof Error ? e.message : '인증에 실패했습니다.');}
    finally {setBusy(false);}
  };
  return <main className="auth-layout">
    <section className="auth-deco">
      <div className="sparkle"><Sparkles size={20}/> 순간을 간직하는 곳</div>
      <div className="deco-heart"><Heart size={90} strokeWidth={1}/></div>
      <h1>우리 가족의<br/><em>소중한 이야기</em></h1>
      <p>함께 웃었던 순간, 오래도록 간직할 추억.<br/>우리 가족만의 작은 앨범에 모아두세요.</p>
      <div className="deco-bottom">FAMILY MEMORY GALLERY <span>✦</span> PRIVATE SPACE</div>
    </section>
    <section className="auth-panel">
      <div className="brand-logo"><span className="brand-mark"><Heart size={19} fill="currentColor"/></span> Family Memories</div>
      <div className="auth-form">
        <div className="eyebrow">WELCOME HOME</div>
        <h2>{signup?'가족 앨범 계정 만들기':'다시 만나서 반가워요'}</h2>
        <p className="muted">가족 구성원만 초대를 통해 앨범을 볼 수 있습니다.</p>
        <form onSubmit={submit}>
          <label>이메일<input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></label>
          <label>비밀번호<input required minLength={6} type="password" autoComplete={signup?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder="비밀번호 입력"/></label>
          <button className="btn primary full" disabled={busy}>{busy?'처리 중...':signup?'가입하기':'가족 앨범 들어가기'} <ChevronRight size={18}/></button>
        </form>
        {message && <p className="notice" role="status">{message}</p>}
        {signup && <button type="button" className="text-link" disabled={busy || !email.trim()} onClick={()=>void resendConfirmation()}>{emailSent?'인증 메일 다시 받기':'인증 메일이 오지 않았나요? 다시 보내기'}</button>}
        <button className="text-link" onClick={()=>{setSignup(!signup);setMessage('');}}>{signup?'이미 계정이 있나요? 로그인':'처음 방문하셨나요? 계정 만들기'}</button>
        <p className="privacy"><LockKeyhole size={14}/> 사진과 영상은 비공개 저장소에 보관됩니다.</p>
      </div>
    </section>
  </main>;
}

function App() {
  const [session,setSession] = useState<Session|null>(null);
  const [checking,setChecking] = useState(true);
  const [me,setMe] = useState<Me|null>(null);
  const [albums,setAlbums] = useState<Album[]>([]);
  const [media,setMedia] = useState<Media[]>([]);
  const [urls,setUrls] = useState<Record<string,string>>({});
  const [tab,setTab] = useState<Tab>('home');
  const [album,setAlbum] = useState<string>('all');
  const [query,setQuery] = useState('');
  const [toast,setToast] = useState('');
  const [newAlbum,setNewAlbum] = useState(false);
  const [newName,setNewName] = useState('');
  const [newDate,setNewDate] = useState('');
  const [viewer,setViewer] = useState<Media|null>(null);
  const [viewerUrl,setViewerUrl] = useState('');
  const [uploading,setUploading] = useState(false);
  const [progress,setProgress] = useState('');
  const [inviteCode,setInviteCode] = useState(new URLSearchParams(window.location.search).get('invite') || '');
  const [inviteEmail,setInviteEmail] = useState('');
  const [inviteRole,setInviteRole] = useState('viewer');
  const [inviteUrl,setInviteUrl] = useState('');
  const [members,setMembers] = useState<FamilyMember[]>([]);
  const [trash,setTrash] = useState<DeletedMedia[]>([]);
  const [usage,setUsage] = useState({usedBytes:0,maxBytes:8589934592});
  const [menu,setMenu] = useState(false);
  const flash = (s:string) => {setToast(s);};
  const reload = useCallback(async () => {
    if(!supa)return;
    try {
      const profile = await api<Me>('/me');
      setMe(profile);
      if(profile.family) {
        const [a,m,u] = await Promise.all([
          api<{albums:Album[]}>('/albums'),api<{media:Media[]}>('/media'),
          api<{usedBytes:number;maxBytes:number}>('/storage/usage')
        ]);
        setAlbums(a.albums || []);setMedia(m.media || []);setUsage(u);
      } else {setAlbums([]);setMedia([]);}
    } catch(e) {flash(e instanceof Error?e.message:'갤러리를 불러올 수 없습니다.');}
  },[]);
  useEffect(()=>{
    if(!supa){setChecking(false);return;}
    void supa.auth.getSession().then(({data})=>{setSession(data.session);setChecking(false);});
    const {data:sub}=supa.auth.onAuthStateChange((_event,s)=>{setSession(s);if(!s){setMe(null);setAlbums([]);setMedia([]);}});
    return ()=>sub.subscription.unsubscribe();
  },[]);
  useEffect(()=>{if(session) void reload();},[session?.user.id,reload]);
  useEffect(()=>{
    if(!session || !me?.family)return;
    if(tab==='family') void api<{members:FamilyMember[]}>('/family/members').then(r=>setMembers(r.members)).catch(e=>flash(e.message));
    if(tab==='trash') void api<{media:DeletedMedia[]}>('/trash').then(r=>setTrash(r.media)).catch(e=>flash(e.message));
  },[tab,me?.family?.id,session?.user.id]);

  const selectedAlbum = albums.find(a=>a.id===album);
  const visible = useMemo(()=> media.filter(m=>(album==='all'||m.album_id===album) &&
    (!query.trim() || m.original_filename.toLowerCase().includes(query.toLowerCase()) ||
      (albums.find(a=>a.id===m.album_id)?.title||'').toLowerCase().includes(query.toLowerCase()))),[media,album,query,albums]);
  useEffect(()=>{
    if(!me?.family || tab==='family' || tab==='trash') return;
    const items=visible.slice(0,150).filter(m=>m.media_type==='image'||!!m.thumbnail_key).filter(m=>!urls[m.id]);
    if(!items.length)return;
    let active=true;
    void Promise.all(items.map(async m=>{
      try {
        const r=await api<{url:string}>('/media/'+m.id+'/access?variant=thumbnail');
        return [m.id,r.url] as const;
      }catch{return null;}
    })).then(pairs=>{
      if(active)setUrls(old=>({...old,...Object.fromEntries(pairs.filter((p):p is readonly [string,string]=>!!p))}));
    });
    return ()=>{active=false;};
  },[visible,me?.family?.id,tab]);

  const submitAlbum = async(e:React.FormEvent)=>{
    e.preventDefault();
    try{await api('/albums',{method:'POST',body:JSON.stringify({title:newName,eventDate:newDate||null})});setNewAlbum(false);setNewName('');setNewDate('');await reload();flash('앨범을 만들었습니다.');}
    catch(e){flash(e instanceof Error?e.message:'앨범 생성 실패');}
  };
  const editAlbum = async (a:Album) => {
    const title=window.prompt('앨범 이름 수정',a.title);
    if(!title || title===a.title)return;
    try{await api('/albums/'+a.id,{method:'PATCH',body:JSON.stringify({title,description:a.description,eventDate:a.event_date})});await reload();}
    catch(e){flash(e instanceof Error?e.message:'수정 실패');}
  };
  const uploadFiles = async (files:FileList|null) => {
    if(!files?.length)return;
    if(album==='all'){flash('먼저 앨범을 선택해 주세요.');return;}
    setUploading(true);
    let success=0;
    try{
      const queue=Array.from(files).slice(0,50);
      for(let i=0;i<queue.length;i++){
        const file=queue[i];
        setProgress((i+1)+'/'+queue.length+' · '+file.name);
        let mediaId='';
        try{
          const kind=file.type.startsWith('image/')?'image':'video';
          const init=await api<{mediaId:string;method:'single'|'multipart';uploadUrl?:string;partSize?:number}>('/media/init',{
            method:'POST',body:JSON.stringify({albumId:album,kind,mimeType:file.type,filename:file.name,
              sizeBytes:file.size,capturedAt:new Date(file.lastModified).toISOString()})
          });
          mediaId=init.mediaId;
          let parts:{PartNumber:number;ETag:string}[]=[];
          if(init.method==='single') {
            const response=await fetch(init.uploadUrl!,{method:'PUT',headers:{'Content-Type':file.type},body:file});
            if(!response.ok)throw new Error('원본 전송 실패 ('+response.status+')');
          } else {
            const partSize=init.partSize || 10485760;
            for(let start=0,n=1;start<file.size;start+=partSize,n++){
              setProgress((i+1)+'/'+queue.length+' · '+file.name+' ('+Math.round((start/file.size)*100)+'%)');
              const {uploadUrl}=await api<{uploadUrl:string}>('/media/'+mediaId+'/part',{
                method:'POST',body:JSON.stringify({partNumber:n})
              });
              const result=await fetch(uploadUrl,{method:'PUT',body:file.slice(start,Math.min(start+partSize,file.size))});
              if(!result.ok)throw new Error('영상 분할 전송 실패');
              const tag=result.headers.get('ETag');
              if(!tag)throw new Error('R2 CORS의 ETag 노출 설정을 확인하세요.');
              parts.push({PartNumber:n,ETag:tag});
            }
          }
          await api('/media/'+mediaId+'/complete',{method:'POST',body:JSON.stringify({parts})});
          const thumb=await thumbnail(file);
          if(thumb && thumb.size<1048576) {
            try {
              const {uploadUrl}=await api<{uploadUrl:string}>('/media/'+mediaId+'/thumbnail',{method:'POST'});
              const result=await fetch(uploadUrl,{method:'PUT',headers:{'Content-Type':'image/webp'},body:thumb});
              if(result.ok)await api('/media/'+mediaId+'/thumbnail-complete',{method:'POST'});
            } catch { /* Original stays available even if thumbnail generation fails. */ }
          }
          success++;
        }catch(e){
          if(mediaId)await api('/media/'+mediaId+'/abort',{method:'POST'}).catch(()=>{});
          flash(file.name+': '+(e instanceof Error?e.message:'업로드 오류'));
        }
      }
      await reload(); setUrls({}); flash(success+'개 파일을 업로드했습니다.');
    }finally{setUploading(false);setProgress('');}
  };
  const openMedia=async(m:Media)=>{
    setViewer(m);setViewerUrl('');
    try{const r=await api<{url:string}>('/media/'+m.id+'/access');setViewerUrl(r.url);}
    catch(e){flash(e instanceof Error?e.message:'열 수 없습니다.');setViewer(null);}
  };
  const deleteMedia=async(m:Media)=>{
    if(!window.confirm('파일을 휴지통으로 이동할까요?'))return;
    try{await api('/media/'+m.id,{method:'DELETE'});setViewer(null);await reload();flash('휴지통으로 이동했습니다.');}
    catch(e){flash(e instanceof Error?e.message:'삭제 실패');}
  };
  const redeem=async()=>{
    try {await api('/invitations/accept',{method:'POST',body:JSON.stringify({token:inviteCode.trim()})});
      window.history.replaceState({},'',window.location.pathname);setInviteCode('');await reload();flash('가족에 참여했습니다!');}
    catch(e){flash(e instanceof Error?e.message:'초대를 수락하지 못했습니다.');}
  };
  const createInvite=async()=>{
    try{
      const result=await api<{inviteUrl:string}>('/invitations',{method:'POST',body:JSON.stringify({email:inviteEmail,role:inviteRole})});
      setInviteUrl(result.inviteUrl);flash('초대 링크가 생성되었습니다.');
    }catch(e){flash(e instanceof Error?e.message:'초대 생성 실패');}
  };
  const changeMember=async(u:FamilyMember,role:string,status:string)=>{
    try{await api('/members/'+u.user_id,{method:'PATCH',body:JSON.stringify({role,status})});
      const r=await api<{members:FamilyMember[]}>('/family/members');setMembers(r.members);flash('권한을 변경했습니다.');}
    catch(e){flash(e instanceof Error?e.message:'변경 실패');}
  };
  const restore=async(m:DeletedMedia)=>{
    try{await api('/media/'+m.id+'/restore',{method:'POST'});setTrash(old=>old.filter(x=>x.id!==m.id));await reload();flash('사진을 복원했습니다.');}
    catch(e){flash(e instanceof Error?e.message:'복원 실패');}
  };
  const logout=()=>{void supa?.auth.signOut();};
  const nav=(t:Tab)=>{setTab(t);setMenu(false);if(t!=='home')setAlbum('all');};
  if(!configured)return <div className="setup"><ShieldCheck size={38}/><h1>Family Memories</h1><p>아직 데이터베이스와 비공개 저장소가 연결되지 않았습니다.</p><p>README에 따라 Supabase, Cloudflare Workers 환경변수를 설정해 주세요.</p><a href="https://github.com/Hyeopgeon-Lee/family-memory-gallery">설정 방법 보기</a></div>;
  if(checking)return <div className="loading"><Heart size={35}/> 추억 앨범을 준비하고 있습니다...</div>;
  if(!session)return <AuthScreen onSignedIn={()=>void reload()}/>;
  if(!me)return <div className="loading"><RefreshCw size={30}/> 계정 확인 중... <button onClick={()=>void reload()}>다시 시도</button></div>;
  if(!me.family)return <div className="gate">
    <div className="gate-card"><span className="brand-mark"><Heart fill="currentColor"/></span>
      <h1>가족의 초대를 기다리고 있어요</h1><p>{me.user.email} 계정으로 로그인했습니다.</p>
      <p className="muted">가족 관리자가 보내준 초대 링크를 열거나 코드를 입력해 주세요.</p>
      <label>초대 코드<input value={inviteCode} onChange={e=>setInviteCode(e.target.value)} placeholder="가족에게 받은 초대 코드"/></label>
      <button className="btn primary full" disabled={!inviteCode.trim()} onClick={()=>void redeem()}>가족 앨범에 참여하기</button>
      <button className="text-link" onClick={logout}>다른 계정으로 로그인</button>
      {toast && <p className="notice">{toast}</p>}
    </div></div>;

  return <div className="app">
    <aside className={'sidebar '+(menu?'open':'')}>
      <div className="brand"><span className="brand-mark"><Heart size={20} fill="currentColor"/></span><div><strong>Family Memories</strong><small>우리 가족의 추억 저장소</small></div></div>
      <div className="side-label">우리 가족</div>
      <button className={'side-link '+(tab==='home'?'active':'')} onClick={()=>nav('home')}><Home size={19}/> 추억 피드</button>
      <button className={'side-link '+(tab==='albums'?'active':'')} onClick={()=>nav('albums')}><FolderHeart size={19}/> 가족 앨범</button>
      <button className={'side-link '+(tab==='trash'?'active':'')} onClick={()=>nav('trash')}><Trash2 size={19}/> 휴지통</button>
      {canAdmin(me.role)&&<button className={'side-link '+(tab==='family'?'active':'')} onClick={()=>nav('family')}><UsersRound size={19}/> 가족 관리</button>}
      <div className="side-label albums-label">최근 앨범</div>
      {albums.slice(0,6).map(a=><button key={a.id} className={'album-mini '+(album===a.id?'selected':'')} onClick={()=>{setAlbum(a.id);setTab('home');setMenu(false);}}><span className="mini-dot"/><span>{a.title}</span></button>)}
      <div className="sidebar-foot">
        <div className="storage"><div className="between"><span><HardDrive size={15}/> 사용량</span><small>{bytes(usage.usedBytes)} / {bytes(usage.maxBytes)}</small></div>
          <div className="usage-track"><div style={{width:Math.min(100,(usage.usedBytes/usage.maxBytes)*100)+'%'}}/></div></div>
        <button className="account" onClick={logout}><span className="avatar">{me.user.email?.slice(0,1).toUpperCase()}</span><span><strong>{me.user.email?.split('@')[0]}</strong><small>{me.role==='owner'?'가족 소유자':me.role==='admin'?'관리자':me.role==='contributor'?'등록자':'열람자'}</small></span><LogOut size={17}/></button>
      </div>
    </aside>
    {menu&&<div className="menu-shade" onClick={()=>setMenu(false)} />}
    <main className="main">
      <header className="topbar">
        <button className="icon-btn menu-button" aria-label="메뉴" onClick={()=>setMenu(true)}><Menu size={22}/></button>
        <div className="breadcrumb"><Heart size={15} fill="currentColor"/> {me.family.name} <ChevronRight size={15}/> <span>{tab==='home'?'추억 피드':tab==='albums'?'가족 앨범':tab==='trash'?'휴지통':'가족 관리'}</span></div>
        <div className="top-actions"><span className="private-tag"><LockKeyhole size={13}/> 가족 전용</span><button className="icon-btn" title="새로고침" onClick={()=>void reload()}><RefreshCw size={18}/></button></div>
      </header>
      <div className="content">
        {(tab==='home'||tab==='albums')&&<>
          <section className="welcome"><div><div className="eyebrow"><Sparkles size={15}/> OUR PRECIOUS MOMENTS</div><h1>{selectedAlbum?selectedAlbum.title:'우리 가족의 모든 순간'}</h1><p>{selectedAlbum?selectedAlbum.description||'한 장 한 장, 소중한 추억을 담아두는 공간입니다.':'오래도록 간직하고 싶은 우리 가족의 이야기. 오늘도 추억 하나를 더해보세요.'}</p></div><div className="welcome-illustration"><Heart size={78} strokeWidth={1.15}/><span>together,<br/>forever.</span></div></section>
          <section className="stats"><div><div className="stat-icon pink"><Images size={19}/></div><span>전체 사진·영상</span><strong>{media.length.toLocaleString()}<small>개</small></strong></div><div><div className="stat-icon apricot"><FolderHeart size={19}/></div><span>가족 앨범</span><strong>{albums.length}<small>개</small></strong></div><div><div className="stat-icon lavender"><CalendarDays size={19}/></div><span>우리의 추억</span><strong>{new Set(media.map(m=>(m.captured_at||m.created_at).slice(0,4))).size}<small>년</small></strong></div></section>
          <div className="section-heading"><div><span className="eyebrow">MEMORIES</span><h2>{tab==='albums'?'가족 앨범':'사진과 영상'}</h2><p className="muted">{tab==='albums'?'함께한 날들을 앨범별로 둘러보세요.':'가장 소중한 순간을 언제든 다시 만나보세요.'}</p></div>
            <div className="tools">{canWrite(me.role)&&<button className="btn outline" onClick={()=>setNewAlbum(true)}><Plus size={17}/> 앨범 만들기</button>}</div></div>
          {(tab==='albums')&&<div className="album-grid">
            {albums.map(a=><button key={a.id} className="album-card" onClick={()=>{setAlbum(a.id);setTab('home');}}>
              <span className="album-cover"><FolderHeart size={42}/></span><strong>{a.title}</strong><small>{a.event_date?prettyDate(a.event_date):prettyDate(a.created_at)}</small>
              {canWrite(me.role)&&<span className="edit-album" onClick={e=>{e.stopPropagation();void editAlbum(a);}}><Edit3 size={14}/></span>}
            </button>)}
            {albums.length===0&&<div className="empty">아직 앨범이 없습니다. 첫 앨범을 만들어 주세요.</div>}
          </div>}
          {(tab==='home')&&<>
            <div className="filters"><div className="tabs"><button className={album==='all'?'current':''} onClick={()=>setAlbum('all')}>모든 추억</button>{albums.map(a=><button key={a.id} className={album===a.id?'current':''} onClick={()=>setAlbum(a.id)}>{a.title}</button>)}</div>
              <div className="search"><Search size={17}/><input aria-label="사진 검색" placeholder="파일명·앨범 검색" value={query} onChange={e=>setQuery(e.target.value)}/></div></div>
            {canWrite(me.role)&&album!=='all'&&<label className={'upload-zone '+(uploading?'busy':'')}><UploadCloud size={25}/><span><strong>{uploading?progress:'사진과 영상을 올려주세요'}</strong><small>{uploading?'업로드 중에는 화면을 닫지 마세요.':'클릭해서 선택 · JPEG, PNG, WebP, MP4 · 최대 50개'}</small></span><input type="file" accept="image/jpeg,image/png,image/webp,video/mp4" multiple disabled={uploading} onChange={e=>{void uploadFiles(e.target.files);e.currentTarget.value='';}}/></label>}
            {album==='all'&&canWrite(me.role)&&albums.length>0&&<p className="hint"><UploadCloud size={15}/> 업로드하려면 위의 앨범을 먼저 선택해 주세요.</p>}
            <div className="media-grid">
              {visible.map(m=><button className="media-card" key={m.id} onClick={()=>void openMedia(m)}>
                {urls[m.id]?<img src={urls[m.id]} alt={m.original_filename} loading="lazy" referrerPolicy="no-referrer"/>:<div className="media-placeholder">{m.media_type==='video'?<Film size={35}/>:<ImageOff size={30}/>}</div>}
                {m.media_type==='video'&&<span className="play-icon"><Play size={18} fill="currentColor"/></span>}
                <span className="media-caption"><strong>{m.original_filename}</strong><small>{prettyDate(m.captured_at||m.created_at)}</small></span>
              </button>)}
            </div>
            {visible.length===0&&<div className="empty"><Camera size={38}/><h3>{albums.length===0?'먼저 가족 앨범을 만들어보세요':'아직 등록된 추억이 없어요'}</h3><p>소중한 사진이나 동영상을 올리면 여기에서 함께 볼 수 있어요.</p></div>}
          </>}
        </>}
        {tab==='trash'&&<section><div className="section-heading"><div><span className="eyebrow">RECYCLE BIN</span><h2>휴지통</h2><p className="muted">이동된 파일은 관리자가 직접 정리하기 전까지 R2에 남습니다.</p></div></div><div className="list-cards">{trash.map(m=><div key={m.id} className="list-row"><Trash2 size={19}/><div><strong>{m.original_filename}</strong><small>{prettyDate(m.deleted_at)}</small></div>{canWrite(me.role)&&<button className="btn outline" onClick={()=>void restore(m)}><RotateCcw size={16}/> 복원</button>}</div>)}{trash.length===0&&<div className="empty">휴지통이 비어 있습니다.</div>}</div></section>}
        {tab==='family'&&canAdmin(me.role)&&<section><div className="section-heading"><div><span className="eyebrow">OUR FAMILY</span><h2>가족 구성원 관리</h2><p className="muted">가족만 초대하고 누가 올리고 관리할지 결정하세요.</p></div></div>
          <div className="admin-layout"><div className="panel"><h3><UsersRound size={19}/> 가족 구성원</h3>{members.map(m=><div className="member-row" key={m.user_id}><span className="avatar">{m.email[0]?.toUpperCase()}</span><div className="member-id"><strong>{m.email}</strong><small>{m.status==='active'?'활성':'접근 정지'} · {m.role}</small></div>{m.role!=='owner'&&<div className="member-actions"><select aria-label="구성원 권한" value={m.role} disabled={me.role!=='owner' && m.role==='admin'} onChange={e=>void changeMember(m,e.target.value,m.status)}><option value="viewer">열람자</option><option value="contributor">등록자</option>{me.role==='owner'&&<option value="admin">관리자</option>}</select><button title={m.status==='active'?'접근 정지':'접근 복원'} className="small-button" onClick={()=>void changeMember(m,m.role,m.status==='active'?'suspended':'active')}>{m.status==='active'?'정지':'복원'}</button></div>}</div>)}</div>
          <div className="panel invite"><h3><Plus size={19}/> 가족 초대</h3><p className="muted">초대받는 분의 이메일과 계정 이메일이 같아야 합니다. 링크는 7일 후 만료됩니다.</p><label>이메일<input type="email" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} placeholder="family@example.com"/></label><label>역할<select value={inviteRole} onChange={e=>setInviteRole(e.target.value)}><option value="viewer">열람자</option><option value="contributor">등록자</option>{me.role==='owner'&&<option value="admin">관리자</option>}</select></label><button className="btn primary full" onClick={()=>void createInvite()}>초대 링크 생성</button>{inviteUrl&&<div className="invite-copy"><p>링크를 가족에게 비공개 메시지로 전달하세요.</p><input readOnly aria-label="초대 링크" value={inviteUrl}/><button className="btn outline" onClick={()=>void navigator.clipboard.writeText(inviteUrl).then(()=>flash('초대 링크를 복사했습니다.'))}><Copy size={15}/> 복사</button></div>}</div></div>
        </section>}
      </div>
      <footer>Made for our family, with love. <Heart size={13} fill="currentColor"/> <span>Private Family Gallery</span></footer>
    </main>
    {newAlbum&&<div className="modal-scrim" onClick={()=>setNewAlbum(false)}><div className="modal album-modal" onClick={e=>e.stopPropagation()}><button className="icon-btn modal-close" onClick={()=>setNewAlbum(false)}><X size={21}/></button><div className="eyebrow">NEW ALBUM</div><h2>새 추억 앨범</h2><p className="muted">함께한 날을 위한 앨범을 만들어보세요.</p><form onSubmit={e=>void submitAlbum(e)}><label>앨범 이름<input autoFocus required maxLength={150} value={newName} onChange={e=>setNewName(e.target.value)} placeholder="예: 우리 가족 제주 여행"/></label><label>행사 날짜 (선택)<input type="date" value={newDate} onChange={e=>setNewDate(e.target.value)}/></label><button className="btn primary full">앨범 만들기</button></form></div></div>}
    {viewer&&<div className="modal-scrim viewer" onClick={()=>setViewer(null)}><div className="viewer-dialog" onClick={e=>e.stopPropagation()}><header><div><strong>{viewer.original_filename}</strong><small>{prettyDate(viewer.captured_at||viewer.created_at)} · {bytes(viewer.size_bytes)}</small></div><div className="viewer-actions">{viewerUrl&&<a className="icon-btn" href={viewerUrl} target="_blank" rel="noreferrer" download title="새 탭에서 원본 보기"><Download size={19}/></a>}{(canAdmin(me.role)||viewer.uploaded_by===me.user.id)&&canWrite(me.role)&&<button className="icon-btn" title="휴지통으로" onClick={()=>void deleteMedia(viewer)}><Trash2 size={19}/></button>}<button className="icon-btn" title="닫기" onClick={()=>setViewer(null)}><X size={21}/></button></div></header><div className="viewer-stage">{viewerUrl?(viewer.media_type==='image'?<img src={viewerUrl} alt={viewer.original_filename} referrerPolicy="no-referrer"/>:<video controls playsInline autoPlay src={viewerUrl}/>):<span>파일을 불러오는 중입니다...</span>}</div></div></div>}
    {toast&&<div className="toast" role="status"><Check size={17}/>{toast}<button onClick={()=>setToast('')} aria-label="알림 닫기"><X size={14}/></button></div>}
  </div>;
}
export default App;

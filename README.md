# Family Memory Gallery

가족 전용 비공개 사진·동영상 갤러리입니다.

**배포 대상:** https://family.k-bigdata.kr

- React, Vite, TypeScript · GitHub Pages
- Supabase Auth 및 PostgreSQL (별도 신규 프로젝트)
- Cloudflare Workers API, **비공개** Cloudflare R2

## 초기 설정

1. 새 Supabase 프로젝트를 만들어 SQL Editor에서 `supabase/migrations/0001_initial.sql` 다음 `supabase/migrations/0002_atomic_invite.sql`을 **순서대로** 실행. 기존 업무용 프로젝트에는 실행하지 마세요.
2. Supabase Auth에서 이메일 인증과 필요한 SMTP를 설정. Site URL 및 Redirect URL에 https://family.k-bigdata.kr 등록.
3. Cloudflare R2 비공개 버킷 `family-media-private` (Standard)을 만들고 `r2-cors.json`의 CORS 규칙 설정. S3 API 토큰 생성.
4. Cloudflare Workers Secrets에 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` 등록. `npm run worker:deploy` 명령으로 배포.
5. GitHub Actions Variables에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_BASE_URL` 등록.
6. Settings > Pages > Source = GitHub Actions 및 Custom Domain = family.k-bigdata.kr 설정. DNS `family CNAME Hyeopgeon-Lee.github.io` 추가.
7. 첫 관리자 이메일 가입/인증 후 아래 SQL을 Supabase SQL Editor에서 **한 번만** 실행. 이후 UI에서 초대 링크 발급.

```sql
with new_family as (
 insert into public.families(name,created_by)
 values ('우리 가족','YOUR_AUTH_USER_UUID'::uuid)
 returning id,created_by
)
insert into public.family_members(family_id,user_id,role,status)
select id,created_by,'owner','active' from new_family;
```

```bash
npm install
cp .env.example .env.local
npm run dev
npm run build
npm run worker:dev
```

R2 비공개 버킷을 공개로 변경하지 마세요. Supabase secret/service_role 키와 R2 키는 **절대 브라우저·GitHub 저장소·Actions variables에 저장하지 않습니다.** 공개되는 VITE_ 설정은 Supabase publishable key만 허용합니다. GitHub Pages는 정적 페이지 자체가 공개되므로 가족 사진과 원본은 GitHub에 업로드하지 않습니다.

이메일이 검증된 가족 구성원만 초대를 수락할 수 있습니다. Supabase 익명 가입을 켠 경우 스팸 방지 CAPTCHA 및 Auth 속도 제한을 설정하세요. Supabase 기본 SMTP는 제한이 있어 실제 운영에는 사용자 지정 SMTP를 권장합니다.

데이터 백업: R2는 유일한 사본이 되어서는 안 되며, 가족 사진 원본을 별도 오프라인 저장소에도 보관하세요. 실제 배포 전 다른 가족 ID 접근 거부, 초대 만료, 미디어 원본 URL 만료, 파일 크기 검증을 테스트하세요. 권장 최대 저장량은 8GiB입니다.

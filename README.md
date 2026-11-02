# Family Memory Gallery

가족 전용 비공개 사진·동영상 갤러리입니다.

**배포 대상:** https://family.k-bigdata.kr

- React, Vite, TypeScript · GitHub Pages
- Supabase Auth 및 PostgreSQL (별도 신규 프로젝트)
- Cloudflare Workers API, **비공개** Cloudflare R2

## DB 운영 대상 (2026-11-01)

- 조직: `Family Memories` (기존 업무용 조직과 분리)
- **배포된 가족 API:** `https://family-memory-gallery-api.k-bigdata-family.workers.dev` (Health / 401 차단 / CORS 검증 통과)
- **서울 리전 운영 DB:** `family-memory-gallery-seoul` · `https://ulwkigdzmubyhtqvyzwe.supabase.co`
- 기존 아일랜드 DB `ssaviinhspcqrmlaunpj`: 데이터 0건 확인 후 일시중지, 삭제하지 않음
- Supabase 마이그레이션 3개와 7개 테이블 RLS: **적용 및 검증 완료**
- **Cloudflare R2 비공개 버킷, Workers API 및 GitHub Pages 연동 완료.** 미완료: Supabase Auth Redirect URL, 최초 가족 계정 생성 및 실제 사진·동영상 E2E 테스트.

**Cloudflare 배포 안내:** [R2·Workers 자동 구축 및 비밀키 등록 절차](docs/CLOUDFLARE_SETUP.md)

## 초기 설정

1. **완료:** Family Memories 조직의 서울 리전(`ap-northeast-2`) 프로젝트 `ulwkigdzmubyhtqvyzwe`에 마이그레이션 3개, RLS, 인덱스 적용. **기존 업무용 프로젝트에는 적용하지 마세요.**
2. Supabase Auth에서 이메일 인증과 필요한 SMTP를 설정. Site URL 및 Redirect URL에 https://family.k-bigdata.kr 등록.
3. GitHub Actions Secrets에 Cloudflare API Token/Account ID를 등록하고 [Provision private R2 and deploy family API](https://github.com/Hyeopgeon-Lee/family-memory-gallery/actions/workflows/deploy-worker.yml)를 실행하면, 비공개 `family-media-private` 버킷 및 Wrangler CORS 정책을 자동 생성/설정할 수 있습니다. 이후 R2 S3 API Token을 발급해 서버용 Secrets에 추가합니다.
4. GitHub Actions Secrets에 R2 Access Key ID/Secret 및 서울 Supabase Secret Key를 추가한 뒤 같은 워크플로를 재실행하면, Worker Secrets를 직접 노출하지 않고 배포합니다. 실제 배포는 **Secret 등록 전까지 보류**됩니다.
5. **서울 Supabase URL과 publishable 키는 Pages 워크플로에 반영 완료.** Cloudflare Workers 배포 후 GitHub Actions Variables에 `VITE_API_BASE_URL`만 추가.
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

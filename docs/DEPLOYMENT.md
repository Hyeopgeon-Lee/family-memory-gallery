# 운영 배포 체크리스트 — family.k-bigdata.kr

## 0. 분리 원칙
- 가족용 **새 Supabase 프로젝트**를 생성하세요. 현재 연결된 기존 업무용 Supabase 프로젝트를 사용하거나 덮어쓰지 마세요.
- R2 버킷은 반드시 Standard / Private으로 생성하세요.
- 관리자만 GitHub 및 Cloudflare 관리자 권한을 보유하도록 설정하세요.
- 최초 공개 후 실제 가족 사진을 올리기 전에 권한 테스트를 완료하세요.

## 1. Supabase

1. https://supabase.com/dashboard 에서 새 프로젝트를 만듭니다(대한민국이면 Seoul 리전).
2. SQL Editor에서 `supabase/migrations/0001_initial.sql`을 그대로 실행합니다.
3. Database > Security Advisor와 Performance Advisor에서 경고를 점검합니다.
4. Data API > Settings에서 `public` 스키마가 노출되는지 확인합니다. 2026년 이후 새 프로젝트의 테이블 API 노출은 최소 권한 GRANT 정책에 영향을 받을 수 있으므로 `families`, `family_members`, `albums`, `media`, `invitations`, `comments`, `audit_logs`와 RPC `reserve_media_upload`을 **서버 secret key로 실제 읽기/쓰기 테스트**하세요.
5. Project Settings > API Keys에서 브라우저용 `sb_publishable_...` 및 Worker용 `sb_secret_...` 키를 별도 확인합니다.
6. Authentication > Providers > Email에서 이메일/비밀번호 가입, 이메일 확인을 설정합니다. 실제 가족 이메일을 받으려면 별도 SMTP를 준비합니다.
7. Authentication > URL Configuration: Site URL = `https://family.k-bigdata.kr`, Redirect URLs에 `https://family.k-bigdata.kr/**`, 로컬 테스트 시 `http://localhost:5173/**`를 추가합니다.
8. Auth CAPTCHA 및 속도 제한 활성화를 권장합니다.
9. 첫 사용자 등록 후 Authentication > Users에서 UUID를 확인하고 README의 `최초 가족 생성` SQL을 **한 번만** 실행합니다.

## 2. Cloudflare R2 및 Workers

1. Cloudflare > R2 > Create Bucket: `family-media-private`, Storage class **Standard**, Public access **OFF**.
2. 버킷 CORS 규칙에 `r2-cors.json`을 반영합니다. 브라우저의 PUT 요청 응답에 ETag가 노출되는지 점검합니다.
3. Account ID와 R2 S3 API Access Key ID / Secret Access Key를 확인합니다.
4. 프로젝트 루트에서 `npm install`을 실행한 후, 아래 비밀키들을 등록합니다.

```bash
npx wrangler secret put SUPABASE_URL -c worker/wrangler.toml
npx wrangler secret put SUPABASE_SECRET_KEY -c worker/wrangler.toml
npx wrangler secret put R2_ACCOUNT_ID -c worker/wrangler.toml
npx wrangler secret put R2_ACCESS_KEY_ID -c worker/wrangler.toml
npx wrangler secret put R2_SECRET_ACCESS_KEY -c worker/wrangler.toml
npm run worker:deploy
```

5. 배포된 Workers URL을 확인합니다. Worker의 `CORS_ORIGIN`은 실제 웹 주소와 같아야 합니다.
6. Worker 건강 확인: `GET https://YOUR-WORKER.workers.dev/api/health`의 응답이 `{"status":"ok"}`인지 확인합니다.
7. 워커의 Cron trigger `0 2 * * *` (매일 UTC 02시)에 미완료 업로드 24시간 이후 정리와 휴지통 30일 이후 삭제 로직이 등록됩니다.
8. R2 서명 URL은 S3 API 도메인에서 작동합니다. 사용자가 접속하는 `family.k-bigdata.kr`은 GitHub Pages 사이트이며, R2 공개 도메인으로 연결하지 않습니다.

## 3. GitHub Pages

1. Repository > Settings > Secrets and variables > Actions > **Variables**에 아래 3개를 추가합니다.
   - `VITE_SUPABASE_URL`: Supabase Project URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: 브라우저용 publishable 키
   - `VITE_API_BASE_URL`: Workers 배포 URL (마지막 / 제외)
2. **절대** `SUPABASE_SECRET_KEY`나 R2 API 키를 GitHub Actions Variables에 넣지 마세요.
3. Settings > Pages > Build and deployment > Source: **GitHub Actions**.
4. Settings > Pages > Custom domain: `family.k-bigdata.kr`을 저장합니다. 저장소의 `public/CNAME`만으로 Settings 설정이 완료되지는 않습니다.
5. DNS 관리자에서 아래 레코드를 추가합니다.
   - TYPE: `CNAME`
   - NAME: `family`
   - TARGET: `Hyeopgeon-Lee.github.io`
6. DNS 확인 후 GitHub Pages의 **Enforce HTTPS**를 활성화합니다.
7. Actions > Validate family gallery / Deploy family gallery 작업의 성공 여부를 확인합니다.

## 4. 검증 시나리오 (모두 통과 후 실제 사진 사용)

- [ ] 로그인 전 /api/albums, /api/media 요청은 401.
- [ ] 이메일만 가입한 미초대 계정은 데이터/미디어에 접근 불가.
- [ ] 초대받지 않은 이메일의 초대 링크 수락은 403.
- [ ] 같은 초대 코드 재사용 및 7일 경과 초대는 거부.
- [ ] viewer는 앨범 보기만 가능하고 업로드 및 관리자 API는 403.
- [ ] contributor는 업로드 가능하나 다른 가족 멤버 변경 불가.
- [ ] admin은 owner의 역할이나 상태 변경 불가.
- [ ] 정상 사진 업로드, 썸네일, 원본 조회, 다운로드 성공.
- [ ] 100MB 이상 MP4 멀티파트 전송 및 ETag 수신 확인.
- [ ] JPG 파일을 MP4로 위장한 요청은 MIME 검사 또는 업로드 후 검증에서 거부되는지 확인 (현재는 파일 내부 시그니처 검사 미구현 — 보완 필요).
- [ ] 다른 가족 ID의 미디어 경로 접근은 404/403.
- [ ] 사전에 발급한 URL이 만료 후 새 요청에서 403.
- [ ] 휴지통 이동 후 새로운 서명 URL을 발급하지 않음.
- [ ] 휴지통 파일 포함 예약 용량이 8GiB 한도를 넘으면 새 업로드를 차단.
- [ ] 썸네일이 없는 영상은 큰 원본 파일을 갤러리 그리드에서 자동 다운로드하지 않음.
- [ ] R2 버킷 Public Access가 꺼져 있고 익명 GET은 실패.
- [ ] 사진 GPS 등 EXIF 위치정보를 대외 화면과 로그에 표시하지 않음.

## 미구현 및 운영 전 보완
- HEIC/HEIF, MOV/HEVC 변환 및 코덱 호환성 자동 진단
- 원본 파일 내용의 magic-bytes 검사 및 바이러스 검사
- 수개월 이후에도 신뢰할 수 있는 외부 원본 백업
- 대용량 영상의 자막/해상도별 적응형 스트리밍
- 업로드 일시정지 후 복구, 동일 파일 중복 탐지
- 부하·요금 측정, 상세 오류 알림 및 자동화 통합 테스트

**상태 안내:** 이 문서는 배포 설정과 테스트를 위한 것이며, 실제 DNS·Supabase·R2 연동 성공을 의미하지 않습니다.

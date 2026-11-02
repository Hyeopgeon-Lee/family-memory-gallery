# Cloudflare R2 + Workers 연결 — 가족 사진 갤러리

**서비스:** https://family.k-bigdata.kr  
**Supabase:** `Family Memories` 조직 · 서울 프로젝트 `ulwkigdzmubyhtqvyzwe`  
**Cloudflare Worker:** `family-memory-gallery-api`  
**R2 버킷:** `family-media-private` (Standard, 비공개, APAC 위치 힌트)

> **2026-11-01 실행 상태:** 자동 구축 워크플로와 Wrangler용 CORS 설정은 GitHub에 반영되었습니다. [자동 구축 사전 점검 실행](https://github.com/Hyeopgeon-Lee/family-memory-gallery/actions/runs/41301354529)에서 GitHub Actions Secrets 다섯 항목이 아직 등록되지 않은 것으로 확인됐습니다. **실제 Cloudflare 버킷 생성이나 Workers 배포는 아직 실행되지 않았습니다.**

## 1. Cloudflare 계정 배포 인증 준비

Cloudflare [대시보드](https://dash.cloudflare.com/)의 **Storage & databases > R2 > Overview**에서 R2 구독을 활성화합니다. 무료 제공량을 사용하더라도 Cloudflare가 결제 정보 등록을 요구할 수 있으며, 무료 제공량 초과 시 청구가 발생할 수 있습니다.

Cloudflare **Account ID**를 확인합니다. R2 계정 ID가 아니라 *Cloudflare Account ID*이며 보통 32자리 16진수입니다.

[Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens)에서 GitHub Actions 전용 토큰을 생성합니다.

- 가능한 한 계정/리소스 범위를 최소화합니다.
- 필요한 권한은 Workers Scripts **Edit**, Workers R2 Storage **Edit/Read**(버킷 생성·CORS·공개 도메인 상태 조회 포함)입니다. 사용 중인 Cloudflare UI의 권한 이름은 다를 수 있습니다.
- 해당 토큰은 GitHub Actions만 사용하고 브라우저 프런트엔드나 저장소 코드에 넣지 않습니다.
- **R2 S3 API Access Key**와 **Cloudflare API Token**은 별개입니다. 혼동하지 마세요.

[GitHub Actions Secrets](https://github.com/Hyeopgeon-Lee/family-memory-gallery/settings/secrets/actions)에 아래 **Repository secrets** 2개를 먼저 등록합니다.

| Secret 이름 | 값 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 위 Cloudflare 계정의 Wrangler 배포용 API Token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |

[Cloudflare 배포 Actions](https://github.com/Hyeopgeon-Lee/family-memory-gallery/actions/workflows/deploy-worker.yml)에서 **Run workflow**를 실행하면 다음을 자동 처리합니다.

- 기존 `family-media-private` 버킷이 없다면 APAC 위치 힌트 및 Standard 스토리지 클래스로 생성
- R2의 `r2.dev` 공개 URL 비활성화 및 공개 사용자 지정 도메인 연결 여부 검사
- `r2-cors-wrangler.json`을 적용하고 CORS 정책 조회
- S3/Supabase 키가 아직 없으면 Workers 배포는 수행하지 않고 누락된 Secret **이름만** 로그로 안내

> Cloudflare R2의 `--location apac`은 위치 *힌트*로서 반드시 한국 리전 저장을 보장하는 설정은 아닙니다. 한국 내 저장이 필수라면 R2 데이터 위치 정책을 별도로 확인하세요.

## 2. S3 API 토큰과 Supabase 서버용 Secret 추가

R2 버킷을 만든 후 Cloudflare R2 Overview > **Manage R2 API Tokens** > Create API Token에서 다음과 같이 S3 API용 R2 토큰을 발급합니다.

- 권한: **Object Read & Write**
- 범위: **Specific buckets only** > `family-media-private`
- 발급 직후 보이는 **Access Key ID**, **Secret Access Key**를 각각 GitHub Actions Secrets에 등록합니다. Secret Access Key는 다시 표시되지 않으니 안전한 암호 관리 도구에도 보관하세요.

[Supabase 서울 프로젝트 API Keys](https://supabase.com/dashboard/project/ulwkigdzmubyhtqvyzwe/settings/api-keys)에서 **Secret key** (`sb_secret_...`)를 확인해 GitHub Actions Secret에 등록합니다. `anon` 또는 `sb_publishable_` 키나 DB 비밀번호를 여기에 사용하면 안 됩니다.

| Secret 이름 | 값 |
|---|---|
| `R2_ACCESS_KEY_ID` | R2 S3 API Token 발급 화면의 Access Key ID |
| `R2_SECRET_ACCESS_KEY` | R2 S3 API Token 발급 화면의 Secret Access Key |
| `SUPABASE_SECRET_KEY` | **서울 프로젝트** 서버용 `sb_secret_...` 키 |

**중요:** 실제 비밀키를 GitHub 저장소 파일, GitHub Actions **Variables**, 이메일 또는 ChatGPT 대화에 붙여넣지 않습니다. **Secrets** 입력창에만 넣으세요.

## 3. 자동으로 Worker 배포하기

[GitHub Actions > Provision private R2 and deploy family API](https://github.com/Hyeopgeon-Lee/family-memory-gallery/actions/workflows/deploy-worker.yml)에서 **Run workflow** 버튼으로 실행합니다.

워크플로는 GitHub Actions Secrets를 임시 런너 메모리/파일에서만 읽어 Wrangler `--secrets-file`로 전송하고, 작업 완료 시 임시 파일을 삭제합니다. Cloudflare Worker에는 아래 값이 암호화된 Secret으로 구성됩니다.

- `SUPABASE_URL` = `https://ulwkigdzmubyhtqvyzwe.supabase.co`
- `SUPABASE_SECRET_KEY` = 서울 Supabase 서버용 Secret
- `R2_ACCOUNT_ID` = Cloudflare Account ID
- `R2_ACCESS_KEY_ID` = R2 전용 Access Key ID
- `R2_SECRET_ACCESS_KEY` = R2 전용 Secret Key

Worker 고정 변수는 `worker/wrangler.toml`에 지정돼 있습니다: `CORS_ORIGIN=https://family.k-bigdata.kr`, `R2_BUCKET=family-media-private`, `MAX_FAMILY_BYTES=8589934592`.

배포 성공 로그 또는 실행 **Summary**에서 `https://family-memory-gallery-api.<Cloudflare-subdomain>.workers.dev` 형태의 URL을 확인합니다. **실제 서브도메인은 배포 결과에서 읽어야 하며 추측하지 않습니다.**

Worker URL의 `/api/health`가 HTTP 200 및 `{"status":"ok"}`로 응답하는지 확인합니다. (이는 실행 확인이며 실제 업로드 검증을 대신하지는 않습니다.)

## 4. GitHub Pages와 API 연결

[GitHub Actions Variables](https://github.com/Hyeopgeon-Lee/family-memory-gallery/settings/variables/actions)에서 `VITE_API_BASE_URL`에 위 Worker URL을 등록합니다. 예: `https://family-memory-gallery-api.example.workers.dev` (예시는 그대로 사용하면 안 됩니다).

**서울 Supabase URL과 공개용 publishable 키는 Pages 배포 워크플로에 이미 반영돼 있습니다.** Secret 키는 GitHub Pages에 입력하면 안 됩니다.

이후 [GitHub Actions > Deploy family gallery](https://github.com/Hyeopgeon-Lee/family-memory-gallery/actions/workflows/pages.yml)에서 **Run workflow**를 눌러 새 API URL로 재빌드·배포합니다.

## 5. 실사용 전 필수 확인

1. Supabase [Authentication URL Configuration](https://supabase.com/dashboard/project/ulwkigdzmubyhtqvyzwe/auth/url-configuration)에서 Site URL 및 Redirect URLs에 `https://family.k-bigdata.kr` 등록.
2. 메일/비밀번호 가입과 이메일 인증(사용자 지정 SMTP 필요 가능)을 점검하고 첫 계정 생성.
3. Supabase Auth Users에서 관리자 UUID를 확인한 다음 README의 최초 가족 생성 SQL을 **한 번만** 실행.
4. 비회원이 /api/media, /api/albums에서 401을 받는지 확인하고, 사진 JPG/PNG/WebP, MP4와 큰 영상 멀티파트 업로드, 썸네일, 재생, 휴지통, 타 가족 접근 차단을 테스트.
5. R2 **Public Access off**, r2.dev disabled, 다른 공개 custom domain 연결 없음, 업로드한 객체의 익명 직접 GET 거부를 검증.

## 참고 문서

- [Cloudflare R2 버킷 생성](https://developers.cloudflare.com/r2/buckets/create-buckets/)
- [Cloudflare R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/)
- [Cloudflare GitHub Actions 배포](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Wrangler Secrets 배포](https://developers.cloudflare.com/workers/configuration/secrets/)
- [R2 S3 API 키 발급](https://developers.cloudflare.com/r2/get-started/s3/)

## 2026-11-02 Cloudflare 연결 및 활성화 상태

- ChatGPT Cloudflare 계정 직접 관리 연결 확인: `Soft1318@naver.com's Account`, Account ID `2489972b43f2909dca9213018d23bedf`.
- R2 목록 API는 **HTTP 403 / 오류 10042** (`Please enable R2 through the Cloudflare Dashboard.`)를 반환. 계정의 **R2 구독/서비스가 아직 활성화되지 않아** 현재 API로 버킷을 만들 수 없음.
- Workers 스크립트 목록은 빈 배열: `family-memory-gallery-api` 미배포.
- Cloudflare R2 처음 활성화는 계정 소유자가 대시보드의 **Storage & databases → R2 → Overview**에서 체크아웃/구독 활성화를 완료해야 함. 무료 이용량이 있지만 이를 넘으면 종량제 요금이 발생할 수 있으므로 확인 필요.
- 이 계정 연결이 유지되는 경우 R2 활성화 뒤 **Cloudflare API 연결을 통해 버킷/CORS/공개접근 설정을 직접 처리할 수 있음**. 이전 섹션의 GitHub API Token 발급은 GitHub Actions로 배포할 때만 필요하며, Cloudflare 연결을 통한 수동 프로비저닝 자체에는 필수 아님.
- 아직 Supabase 서버 secret(`sb_secret_...`)과 R2 S3 전용 접근키가 Worker에 설정되어 있지 않으므로 **실제 사용자 사진을 업로드하면 안 됨**.
